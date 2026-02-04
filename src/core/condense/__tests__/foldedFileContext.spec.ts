// npx vitest src/core/condense/__tests__/foldedFileContext.spec.ts

import * as path from "path"
import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { BaseProvider } from "../../../api/providers/base-provider"

// Mock the tree-sitter module
vi.mock("../../../services/tree-sitter", () => ({
	parseSourceCodeDefinitionsForFile: vi.fn(),
}))

// Mock generateFoldedFileContext for summarizeConversation tests
vi.mock("../foldedFileContext", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../foldedFileContext")>()
	return {
		...actual,
		generateFoldedFileContext: vi.fn().mockImplementation(actual.generateFoldedFileContext),
	}
})

import { generateFoldedFileContext } from "../foldedFileContext"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"

const mockedGenerateFoldedFileContext = vi.mocked(generateFoldedFileContext)

const mockedParseSourceCodeDefinitions = vi.mocked(parseSourceCodeDefinitionsForFile)

describe("foldedFileContext", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("generateFoldedFileContext", () => {
		it("should return empty content for empty file list", async () => {
			const result = await generateFoldedFileContext([], { cwd: "/test" })

			expect(result.content).toBe("")
			expect(result.sections).toEqual([])
			expect(result.filesProcessed).toBe(0)
			expect(result.filesSkipped).toBe(0)
			expect(result.characterCount).toBe(0)
		})

		it("should generate folded context for a TypeScript file with its own system-reminder block", async () => {
			const mockDefinitions = `1--5 | export interface User
7--12 | export function createUser(name: string): User
14--28 | export class UserService`

			mockedParseSourceCodeDefinitions.mockResolvedValue(mockDefinitions)

			const result = await generateFoldedFileContext(["/test/user.ts"], { cwd: "/test" })

			// Each file should be wrapped in its own <system-reminder> block
			expect(result.content).toContain("<system-reminder>")
			expect(result.content).toContain("</system-reminder>")
			expect(result.content).toContain("## File Context: /test/user.ts")
			expect(result.content).toContain("interface User")
			expect(result.content).toContain("function createUser")
			expect(result.content).toContain("class UserService")
			expect(result.filesProcessed).toBe(1)
			expect(result.filesSkipped).toBe(0)
		})

		it("should generate folded context for a JavaScript file with its own system-reminder block", async () => {
			const mockDefinitions = `1--3 | function greet(name)
5--15 | class Calculator`

			mockedParseSourceCodeDefinitions.mockResolvedValue(mockDefinitions)

			const result = await generateFoldedFileContext(["/test/utils.js"], { cwd: "/test" })

			expect(result.content).toContain("<system-reminder>")
			expect(result.content).toContain("## File Context: /test/utils.js")
			expect(result.content).toContain("function greet")
			expect(result.content).toContain("class Calculator")
			expect(result.filesProcessed).toBe(1)
		})

		it("should skip files when parseSourceCodeDefinitions returns undefined", async () => {
			// First file succeeds, second returns undefined
			mockedParseSourceCodeDefinitions
				.mockResolvedValueOnce("1--3 | export const x = 1")
				.mockResolvedValueOnce(undefined)

			const result = await generateFoldedFileContext(["/test/existing.ts", "/test/unsupported.txt"], {
				cwd: "/test",
			})

			expect(result.filesProcessed).toBe(1)
			expect(result.filesSkipped).toBe(1)
		})

		it("should skip files when parseSourceCodeDefinitions throws an error", async () => {
			mockedParseSourceCodeDefinitions
				.mockResolvedValueOnce("1--3 | export const x = 1")
				.mockRejectedValueOnce(new Error("File not found"))

			const result = await generateFoldedFileContext(["/test/existing.ts", "/test/non-existent.ts"], {
				cwd: "/test",
			})

			expect(result.filesProcessed).toBe(1)
			expect(result.filesSkipped).toBe(1)
		})

		it("should skip files when parseSourceCodeDefinitions returns error strings", async () => {
			// Tree-sitter can return error strings for missing or denied files
			// These should be treated as skipped, not embedded in the output
			mockedParseSourceCodeDefinitions
				.mockResolvedValueOnce("1--3 | export const x = 1")
				.mockResolvedValueOnce("This file does not exist or you do not have permission to access it.")
				.mockResolvedValueOnce("Unsupported file type: /test/file.xyz")

			const result = await generateFoldedFileContext(["/test/valid.ts", "/test/missing.ts", "/test/file.xyz"], {
				cwd: "/test",
			})

			// Only the first file should be processed, the other two return error strings
			expect(result.filesProcessed).toBe(1)
			expect(result.filesSkipped).toBe(2)

			// The content should NOT contain the error messages
			expect(result.content).not.toContain("does not exist")
			expect(result.content).not.toContain("do not have permission")
			expect(result.content).not.toContain("Unsupported file type")

			// But it should contain the valid file's content
			expect(result.content).toContain("## File Context: /test/valid.ts")
			expect(result.content).toContain("export const x = 1")
		})

		it("should respect character budget limit", async () => {
			// Create multiple files that would exceed a small budget
			const longDefinitions = `1--3 | export function longFunctionName1()
5--7 | export function longFunctionName2()
9--11 | export function longFunctionName3()`

			mockedParseSourceCodeDefinitions.mockResolvedValue(longDefinitions)

			const result = await generateFoldedFileContext(["/test/file1.ts", "/test/file2.ts", "/test/file3.ts"], {
				cwd: "/test",
				maxCharacters: 200, // Small budget
			})

			expect(result.characterCount).toBeLessThanOrEqual(200)
			// Some files should be skipped due to budget limit
			expect(result.filesSkipped).toBeGreaterThan(0)
		})

		it("should handle Python files with its own system-reminder block", async () => {
			const mockDefinitions = `1--2 | def greet(name)
4--12 | class Person`

			mockedParseSourceCodeDefinitions.mockResolvedValue(mockDefinitions)

			const result = await generateFoldedFileContext(["/test/person.py"], { cwd: "/test" })

			expect(result.content).toContain("<system-reminder>")
			expect(result.content).toContain("## File Context: /test/person.py")
			expect(result.content).toContain("def greet")
			expect(result.content).toContain("class Person")
			expect(result.filesProcessed).toBe(1)
		})

		it("should include file path in the File Context header", async () => {
			mockedParseSourceCodeDefinitions.mockResolvedValue("1--3 | export function helper()")

			const result = await generateFoldedFileContext(["/test/src/utils/helpers.ts"], { cwd: "/test" })

			// The path should appear in the File Context header
			expect(result.content).toContain("## File Context: /test/src/utils/helpers.ts")
		})

		it("should generate separate system-reminder blocks for multiple files", async () => {
			mockedParseSourceCodeDefinitions
				.mockResolvedValueOnce("1--3 | export async function fetchData(url: string): Promise<any>")
				.mockResolvedValueOnce("1--4 | export interface DataModel")

			const result = await generateFoldedFileContext(["/test/api.ts", "/test/models.ts"], { cwd: "/test" })

			// Each file should have its own <system-reminder> block
			const systemReminderMatches = result.content.match(/<system-reminder>/g)
			expect(systemReminderMatches).toHaveLength(2)

			// sections array should have separate entries for each file
			expect(result.sections).toHaveLength(2)
			expect(result.sections[0]).toContain("## File Context: /test/api.ts")
			expect(result.sections[1]).toContain("## File Context: /test/models.ts")

			expect(result.content).toContain("## File Context: /test/api.ts")
			expect(result.content).toContain("## File Context: /test/models.ts")
			expect(result.content).toContain("fetchData")
			expect(result.content).toContain("interface DataModel")
			expect(result.filesProcessed).toBe(2)
		})

		it("should truncate content when approaching character limit", async () => {
			// Create a definition that would fit but is close to the limit
			const longDefinitions = "1--3 | " + "x".repeat(300)

			mockedParseSourceCodeDefinitions.mockResolvedValue(longDefinitions)

			const result = await generateFoldedFileContext(["/test/file1.ts", "/test/file2.ts"], {
				cwd: "/test",
				maxCharacters: 350, // First file will fit, second will be truncated
			})

			// Content should include truncation marker if truncation happened
			expect(result.filesProcessed + result.filesSkipped).toBe(2)
		})
	})

	describe("summarizeConversation with foldedFileContext", () => {
		beforeEach(() => {
			if (!TelemetryService.hasInstance()) {
				TelemetryService.createInstance([])
			}
		})

		// Mock API handler for testing
		class MockApiHandler extends BaseProvider {
			createMessage(): any {
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Mock summary of the conversation" }
						yield { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 }
					},
				}
				return mockStream
			}

			getModel(): { id: string; info: ModelInfo } {
				return {
					id: "test-model",
					info: {
						contextWindow: 100000,
						maxTokens: 50000,
						supportsPromptCache: true,
						supportsImages: false,
						inputPrice: 0,
						outputPrice: 0,
						description: "Test model",
					},
				}
			}

			override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
				let tokens = 0
				for (const block of content) {
					if (block.type === "text") {
						tokens += Math.ceil(block.text.length / 4)
					}
				}
				return tokens
			}
		}

		it("should include folded file context with each file as a separate content block", async () => {
			const { summarizeConversation } = await import("../index")

			const mockApiHandler = new MockApiHandler()
			const taskId = "test-task-id"

			const messages: any[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
				{ role: "assistant", content: "Sixth message" },
				{ role: "user", content: "Seventh message" },
			]

			// Mock generateFoldedFileContext to return the expected folded sections
			const mockFoldedSections = [
				`<system-reminder>
## File Context: src/user.ts
1--5 | export interface User
7--12 | export function createUser(name: string): User
14--28 | export class UserService
</system-reminder>`,
				`<system-reminder>
## File Context: src/api.ts
1--3 | export async function fetchData(url: string): Promise<any>
</system-reminder>`,
			]

			mockedGenerateFoldedFileContext.mockResolvedValue({
				content: mockFoldedSections.join("\n"),
				sections: mockFoldedSections,
				filesProcessed: 2,
				filesSkipped: 0,
				characterCount: mockFoldedSections.join("\n").length,
			})

			const filesReadByRoo = ["src/user.ts", "src/api.ts"]
			const cwd = "/test/project"

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
				filesReadByRoo,
				cwd,
			})

			// Verify generateFoldedFileContext was called with the right arguments
			expect(mockedGenerateFoldedFileContext).toHaveBeenCalledWith(filesReadByRoo, {
				cwd,
				rooIgnoreController: undefined,
			})

			// Verify the summary was created
			expect(result.summary).toBeDefined()
			expect(result.messages.length).toBeGreaterThan(0)

			// Find the summary message
			const summaryMessage = result.messages.find((msg: any) => msg.isSummary)
			expect(summaryMessage).toBeDefined()

			// Each file should have its own content block
			const contentArray = summaryMessage!.content as any[]

			// Find the content blocks containing file contexts
			const userFileBlock = contentArray.find(
				(block: any) => block.type === "text" && block.text?.includes("## File Context: src/user.ts"),
			)
			const apiFileBlock = contentArray.find(
				(block: any) => block.type === "text" && block.text?.includes("## File Context: src/api.ts"),
			)

			expect(userFileBlock).toBeDefined()
			expect(apiFileBlock).toBeDefined()

			// Each file block should have its own <system-reminder> tags
			expect(userFileBlock.text).toContain("<system-reminder>")
			expect(userFileBlock.text).toContain("export interface User")

			expect(apiFileBlock.text).toContain("<system-reminder>")
			expect(apiFileBlock.text).toContain("fetchData")
		})

		it("should not include file context section when filesReadByRoo is empty", async () => {
			const { summarizeConversation } = await import("../index")

			const mockApiHandler = new MockApiHandler()
			const taskId = "test-task-id-2"

			const messages: any[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
				{ role: "assistant", content: "Sixth message" },
				{ role: "user", content: "Seventh message" },
			]

			// Reset the mock to ensure clean state
			mockedGenerateFoldedFileContext.mockClear()

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
				filesReadByRoo: [],
				cwd: "/test/project",
			})

			// generateFoldedFileContext should NOT be called when filesReadByRoo is empty
			expect(mockedGenerateFoldedFileContext).not.toHaveBeenCalled()

			// Find the summary message
			const summaryMessage = result.messages.find((msg: any) => msg.isSummary)
			expect(summaryMessage).toBeDefined()

			// The summary content should NOT contain any file context blocks
			const contentArray = summaryMessage!.content as any[]
			const fileContextBlock = contentArray.find(
				(block: any) => block.type === "text" && block.text?.includes("## File Context"),
			)
			expect(fileContextBlock).toBeUndefined()
		})
	})
})
