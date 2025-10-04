import { GhostModel } from "../GhostModel"
import { GhostXmlStrategy } from "../GhostXmlStrategy"
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
	let strategy: GhostXmlStrategy
	let mockDocument: any
	let context: GhostSuggestionContext

	beforeEach(() => {
		strategy = new GhostXmlStrategy()

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
		it("should process streaming chunks and show suggestions incrementally", async () => {
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
			strategy.initializeStreamingParser(context)

			let firstSuggestionTime: number | null = null
			let finalSuggestionTime: number | null = null
			let suggestionCount = 0

			const startTime = performance.now()

			// Simulate the streaming callback workflow
			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					const parseResult = strategy.processStreamingChunk(chunk.text)

					if (parseResult.hasNewSuggestions && parseResult.suggestions.hasSuggestions()) {
						suggestionCount++

						if (firstSuggestionTime === null) {
							firstSuggestionTime = performance.now()
						}

						if (parseResult.isComplete) {
							finalSuggestionTime = performance.now()
						}
					}
				}
			}

			// Run the streaming generation
			const usageInfo = await model.generateResponse("system prompt", "user prompt", onChunk)

			const endTime = performance.now()

			// Verify streaming behavior
			expect(firstSuggestionTime).not.toBeNull()
			expect(finalSuggestionTime).not.toBeNull()
			expect(suggestionCount).toBeGreaterThan(0)

			// Verify timing - first suggestion should come before final
			expect(firstSuggestionTime!).toBeLessThan(finalSuggestionTime!)
			expect(finalSuggestionTime!).toBeLessThan(endTime)

			// Verify usage info
			expect(usageInfo.inputTokens).toBe(10)
			expect(usageInfo.outputTokens).toBe(20)

			console.log(`First suggestion after: ${(firstSuggestionTime! - startTime).toFixed(2)}ms`)
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

			strategy.initializeStreamingParser(context)

			let suggestionUpdates = 0
			let finalSuggestions: any = null

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					const parseResult = strategy.processStreamingChunk(chunk.text)

					if (parseResult.hasNewSuggestions) {
						suggestionUpdates++
						finalSuggestions = parseResult.suggestions
					}
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Should have received multiple suggestion updates
			expect(suggestionUpdates).toBe(2)
			expect(finalSuggestions).not.toBeNull()
			expect(finalSuggestions.hasSuggestions()).toBe(true)

			// Verify we have the expected number of completed changes
			const completedChanges = strategy.getStreamingCompletedChanges()
			expect(completedChanges).toHaveLength(2)
		})

		it("should handle cancellation during streaming", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{ type: "text", text: "<change><search><![CDATA[function test() {" },
				{ type: "text", text: "\n\treturn true;" },
				// Simulate cancellation before completion
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			strategy.initializeStreamingParser(context)

			let isRequestCancelled = false
			let suggestionCount = 0

			const onChunk = (chunk: ApiStreamChunk) => {
				if (isRequestCancelled) {
					return // Simulate cancellation check
				}

				if (chunk.type === "text") {
					const parseResult = strategy.processStreamingChunk(chunk.text)

					if (parseResult.hasNewSuggestions) {
						suggestionCount++
						// Simulate cancellation after first chunk
						isRequestCancelled = true
					}
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Should have processed some chunks but stopped due to cancellation
			expect(suggestionCount).toBe(0) // No complete suggestions due to cancellation

			// Reset should clear state
			strategy.resetStreamingParser()
			expect(strategy.getStreamingBuffer()).toBe("")
			expect(strategy.getStreamingCompletedChanges()).toHaveLength(0)
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

			strategy.initializeStreamingParser(context)

			let validSuggestions = 0
			let errors = 0

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					try {
						const parseResult = strategy.processStreamingChunk(chunk.text)

						if (parseResult.hasNewSuggestions) {
							validSuggestions++
						}
					} catch (error) {
						errors++
					}
				}
			}

			await model.generateResponse("system", "user", onChunk)

			// Should handle malformed data without crashing
			expect(errors).toBe(0) // No errors thrown
			expect(validSuggestions).toBe(1) // Only the valid suggestion processed
		})
	})

	describe("performance characteristics", () => {
		it("should show first suggestion quickly in streaming mode", async () => {
			const streamingChunks: ApiStreamChunk[] = [
				{
					type: "text",
					text: "<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>",
				},
				{ type: "usage", inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]

			const mockApiHandler = new MockApiHandler(streamingChunks)
			const model = new GhostModel(mockApiHandler as any)

			strategy.initializeStreamingParser(context)

			const startTime = performance.now()
			let firstSuggestionTime: number | null = null

			const onChunk = (chunk: ApiStreamChunk) => {
				if (chunk.type === "text") {
					const parseResult = strategy.processStreamingChunk(chunk.text)

					if (parseResult.hasNewSuggestions && firstSuggestionTime === null) {
						firstSuggestionTime = performance.now()
					}
				}
			}

			await model.generateResponse("system", "user", onChunk)

			const totalTime = performance.now() - startTime
			const timeToFirstSuggestion = firstSuggestionTime! - startTime

			// First suggestion should come quickly (within reasonable bounds for test)
			expect(timeToFirstSuggestion).toBeLessThan(totalTime)
			expect(timeToFirstSuggestion).toBeGreaterThan(0)

			console.log(`Time to first suggestion: ${timeToFirstSuggestion.toFixed(2)}ms`)
			console.log(`Total time: ${totalTime.toFixed(2)}ms`)
		})
	})
})
