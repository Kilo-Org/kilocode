// kilocode_change: file added
import { beforeEach, describe, expect, it, vi } from "vitest"

import { webSearchTool } from "../kilocode/webSearchTool"
import { formatResponse } from "../../prompts/responses"
import { Task } from "../../task/Task"

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe("webSearchTool", () => {
	let mockTask: Partial<Task>
	let askApproval: ReturnType<typeof vi.fn>
	let handleError: ReturnType<typeof vi.fn>
	let pushToolResult: ReturnType<typeof vi.fn>
	let removeClosingTag: (tag: string, text?: string) => string
	let toolProtocol: "xml" | "native"

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			cwd: "/repo",
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing required parameter: query"),
			providerRef: {
				deref: vi.fn().mockReturnValue({ context: {} }),
			} as any,
		}

		askApproval = vi.fn().mockResolvedValue(true)
		handleError = vi.fn()
		pushToolResult = vi.fn()
		removeClosingTag = vi.fn((_, text) => text || "")
		toolProtocol = "xml"
	})

	describe("parseLegacy", () => {
		it("parses query parameter", () => {
			const result = webSearchTool.parseLegacy({ query: "test query" })
			expect(result.query).toBe("test query")
		})

		it("parses num_results parameter", () => {
			const result = webSearchTool.parseLegacy({ query: "test", num_results: "10" })
			expect(result.num_results).toBe(10)
		})

		it("parses livecrawl parameter", () => {
			const result = webSearchTool.parseLegacy({ query: "test", livecrawl: "preferred" })
			expect(result.livecrawl).toBe("preferred")
		})

		it("parses search_type parameter", () => {
			const result = webSearchTool.parseLegacy({ query: "test", search_type: "deep" })
			expect(result.search_type).toBe("deep")
		})

		it("parses context_max_characters parameter", () => {
			const result = webSearchTool.parseLegacy({ query: "test", context_max_characters: "5000" })
			expect(result.context_max_characters).toBe(5000)
		})
	})

	describe("execute", () => {
		it("returns error when query is missing", async () => {
			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: {},
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(pushToolResult).toHaveBeenCalledWith("Missing required parameter: query")
		})

		it("returns tool denied when approval is rejected", async () => {
			askApproval.mockResolvedValue(false)

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(pushToolResult).toHaveBeenCalledWith(formatResponse.toolDenied())
		})

		it("performs search and returns results", async () => {
			const searchResults = {
				jsonrpc: "2.0",
				result: {
					content: [
						{
							type: "text",
							text: "Search result 1: Example content\nSearch result 2: More content",
						},
					],
				},
			}

			mockFetch.mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(`data: ${JSON.stringify(searchResults)}`),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockFetch).toHaveBeenCalledWith(
				"https://mcp.exa.ai/mcp",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"content-type": "application/json",
					}),
				}),
			)

			expect(pushToolResult).toHaveBeenCalled()
			const result = pushToolResult.mock.calls[0][0]
			expect(result).toContain("Web search: test query")
			expect(result).toContain("Search result 1")
		})

		it("handles no results", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(""),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(pushToolResult).toHaveBeenCalledWith("No search results found. Please try a different query.")
		})

		it("handles fetch errors", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"))

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(handleError).toHaveBeenCalledWith("searching the web", expect.any(Error))
		})

		it("handles non-ok response", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				text: vi.fn().mockResolvedValue("Internal Server Error"),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(handleError).toHaveBeenCalledWith("searching the web", expect.any(Error))
		})

		it("sends correct request parameters", async () => {
			const searchResults = {
				jsonrpc: "2.0",
				result: {
					content: [{ type: "text", text: "Results" }],
				},
			}

			mockFetch.mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(`data: ${JSON.stringify(searchResults)}`),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: {
					query: "test query",
					num_results: "15",
					livecrawl: "preferred",
					search_type: "deep",
					context_max_characters: "10000",
				},
				partial: false,
			}

			await webSearchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockFetch).toHaveBeenCalled()
			const fetchCall = mockFetch.mock.calls[0]
			const body = JSON.parse(fetchCall[1].body)

			expect(body.params.arguments.query).toBe("test query")
			expect(body.params.arguments.numResults).toBe(15)
			expect(body.params.arguments.livecrawl).toBe("preferred")
			expect(body.params.arguments.type).toBe("deep")
			expect(body.params.arguments.contextMaxCharacters).toBe(10000)
		})
	})

	describe("handlePartial", () => {
		it("calls task.ask with tool info", async () => {
			const block = {
				type: "tool_use" as const,
				name: "web_search" as const,
				params: { query: "test query" },
				partial: true,
			}

			await webSearchTool.handlePartial(mockTask as Task, block)

			expect(mockTask.ask).toHaveBeenCalledWith("tool", expect.stringContaining('"tool":"webSearch"'), true)
		})
	})
})
