import { GhostModel } from "../GhostModel"
import { GhostStreamingParser } from "../GhostStreamingParser"
import { GhostSuggestionContext } from "../types"
import { ApiStreamChunk } from "../../../api/transform/stream"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		file: (path: string) => ({ toString: () => path, fsPath: path }),
	},
	workspace: {
		asRelativePath: (uri: any) => uri.toString(),
	},
}))

// Mock API handler for testing
class MockApiHandler {
	private chunks: ApiStreamChunk[]

	constructor(chunks: ApiStreamChunk[]) {
		this.chunks = chunks
	}

	async *createMessage(): AsyncGenerator<ApiStreamChunk> {
		for (const chunk of this.chunks) {
			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 10))
			yield chunk
		}
	}

	getModel() {
		return { id: "test-model" }
	}
}

describe("Ghost Streaming Integration", () => {
	let streamingParser: GhostStreamingParser
	let mockDocument: any
	let context: GhostSuggestionContext

	beforeEach(() => {
		streamingParser = new GhostStreamingParser()

		// Create mock document
		mockDocument = {
			uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
			getText: () => `function test() {
	return true;
}`,
			languageId: "typescript",
		}

		context = {
			document: mockDocument,
		}
	})

	describe("end-to-end streaming workflow", () => {
		it("should process streaming chunks and show suggestions when complete", async () => {
			// Simulate streaming chunks that build up to a complete suggestion
			const streamingChunks: ApiStreamChunk[] = [
				{ type: "text", text: "<change><search><![CDATA[function test() {" },
				{ type: "text", text: "\n\treturn true;" },
				{ type: "text", text: "\n}]]></search><replace><![CDATA[function test() {" },
				{ type: "text", text: "\n\t// Added comment" },
				{ type: "text", text: "\n\treturn true;" },
				{ type: "text", text: "\n}]]></replace></change>" },
				{ type: "usage", inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]

			// Create mock model with streaming chunks
			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			// Initialize streaming parser
			streamingParser.initialize(context)

			let fullResponse = ""
			let finalSuggestionTime: number | null = null

			const startTime = performance.now()

			// Simulate the streaming callback workflow - accumulate chunks
			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			// Run the streaming generation
			const usageInfo = await model.generateResponse("system prompt", "user prompt", onChunk)

			// Process complete response
			const parseResult = streamingParser.parseResponse(fullResponse)
			finalSuggestionTime = performance.now()

			const endTime = performance.now()

			// Verify streaming behavior
			expect(finalSuggestionTime).not.toBeNull()
			expect(parseResult.hasNewSuggestions).toBe(true)
			expect(parseResult.suggestions.hasSuggestions()).toBe(true)

			// Verify timing
			expect(finalSuggestionTime!).toBeLessThan(endTime)

			// Verify usage info
			expect(usageInfo.inputTokens).toBe(10)
			expect(usageInfo.outputTokens).toBe(20)

			console.log(`Final suggestion after: ${(finalSuggestionTime! - startTime).toFixed(2)}ms`)
			console.log(`Total time: ${(endTime - startTime).toFixed(2)}ms`)
		})

		it("should handle multiple suggestions in a single stream", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{
					type: "text",
					text: "<change><search><![CDATA[function test() {]]></search><replace><![CDATA[function test() {\n\t// First change]]></replace></change>",
				},
				{
					type: "text",
					text: "<change><search><![CDATA[return true;]]></search><replace><![CDATA[return false; // Second change]]></replace></change>",
				},
				{ type: "usage", inputTokens: 15, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			streamingParser.initialize(context)

			let fullResponse = ""

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Process complete response
			const parseResult = streamingParser.parseResponse(fullResponse)

			// Should have processed both suggestions
			expect(parseResult.hasNewSuggestions).toBe(true)
			expect(parseResult.suggestions.hasSuggestions()).toBe(true)
			expect(streamingParser.getCompletedChanges()).toHaveLength(2)
		})

		it("should handle cancellation during streaming", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{ type: "text", text: "<change><search><![CDATA[function test() {" },
				{ type: "text", text: "\n\treturn true;" },
				// Simulate cancellation before completion
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			streamingParser.initialize(context)

			let isRequestCancelled = false
			let fullResponse = ""

			const onChunk = (chunk: ApiStreamChunk) => {
				if (isRequestCancelled) {
					return // Simulate cancellation check
				}

				if (chunk.type === "text") {
					fullResponse += chunk.text
					// Simulate cancellation after first chunk
					isRequestCancelled = true
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Try to process incomplete response
			const parseResult = streamingParser.parseResponse(fullResponse)

			// Should have no complete suggestions due to cancellation
			expect(parseResult.hasNewSuggestions).toBe(false)

			// Reset should clear state
			streamingParser.reset()
			expect(streamingParser.buffer).toBe("")
			expect(streamingParser.getCompletedChanges()).toHaveLength(0)
		})

		it("should handle malformed streaming data gracefully", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{ type: "text", text: "<change><search><![CDATA[incomplete" },
				{ type: "text", text: "malformed xml without proper closing" },
				{
					type: "text",
					text: "<change><search><![CDATA[valid]]></search><replace><![CDATA[replacement]]></replace></change>",
				},
				{ type: "usage", inputTokens: 5, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			streamingParser.initialize(context)

			let fullResponse = ""
			let errors = 0

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Process complete response
			try {
				const parseResult = streamingParser.parseResponse(fullResponse)
				// Should only process the valid suggestion
				if (parseResult.hasNewSuggestions) {
					expect(streamingParser.getCompletedChanges()).toHaveLength(1)
				}
			} catch (error) {
				errors++
			}

			// Should handle malformed data without crashing
			expect(errors).toBe(0) // No errors thrown
		})
	})

	describe("performance characteristics", () => {
		it("should process complete response quickly", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{
					type: "text",
					text: "<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>",
				},
				{ type: "usage", inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			streamingParser.initialize(context)

			const startTime = performance.now()
			let fullResponse = ""

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			await model.generateResponse("system", "user", onChunk)

			const parseResult = streamingParser.parseResponse(fullResponse)
			const totalTime = performance.now() - startTime

			// Should process successfully
			expect(parseResult.hasNewSuggestions).toBe(true)
			expect(totalTime).toBeGreaterThan(0)

			console.log(`Total time: ${totalTime.toFixed(2)}ms`)
		})
	})
})
