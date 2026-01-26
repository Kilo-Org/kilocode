// kilocode_change: file added
import { beforeEach, describe, expect, it, vi } from "vitest"

import { webFetchTool } from "../kilocode/webFetchTool"
import { formatResponse } from "../../prompts/responses"
import { Task } from "../../task/Task"

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe("webFetchTool", () => {
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
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing required parameter: url"),
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
		it("parses url parameter", () => {
			const result = webFetchTool.parseLegacy({ url: "https://example.com" })
			expect(result.url).toBe("https://example.com")
		})

		it("parses format parameter", () => {
			const result = webFetchTool.parseLegacy({ url: "https://example.com", format: "text" })
			expect(result.format).toBe("text")
		})

		it("defaults format to markdown", () => {
			const result = webFetchTool.parseLegacy({ url: "https://example.com" })
			expect(result.format).toBe("markdown")
		})

		it("parses timeout parameter", () => {
			const result = webFetchTool.parseLegacy({ url: "https://example.com", timeout: "60" })
			expect(result.timeout).toBe(60)
		})
	})

	describe("execute", () => {
		it("returns error when url is missing", async () => {
			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: {},
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(pushToolResult).toHaveBeenCalledWith("Missing required parameter: url")
		})

		it("returns error when url does not start with http:// or https://", async () => {
			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "ftp://example.com" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
			expect(pushToolResult).toHaveBeenCalledWith(
				formatResponse.toolError("URL must start with http:// or https://", toolProtocol),
			)
		})

		it("returns tool denied when approval is rejected", async () => {
			askApproval.mockResolvedValue(false)

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(pushToolResult).toHaveBeenCalledWith(formatResponse.toolDenied())
		})

		it("fetches URL and returns content", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				headers: new Map([
					["content-type", "text/html"],
					["content-length", "100"],
				]),
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(new TextEncoder().encode("<html><body>Hello World</body></html>")),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(mockFetch).toHaveBeenCalled()
			expect(pushToolResult).toHaveBeenCalled()
			const result = pushToolResult.mock.calls[0][0]
			expect(result).toContain("URL: https://example.com")
			expect(result).toContain("Hello World")
		})

		it("handles fetch errors", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"))

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(handleError).toHaveBeenCalledWith("fetching URL", expect.any(Error))
		})

		it("handles non-ok response", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				headers: new Map(),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			expect(handleError).toHaveBeenCalledWith("fetching URL", expect.any(Error))
		})

		it("returns text format when requested", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				headers: new Map([
					["content-type", "text/html"],
					["content-length", "100"],
				]),
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(
						new TextEncoder().encode("<html><body><script>alert(1)</script>Hello World</body></html>"),
					),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com", format: "text" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			const result = pushToolResult.mock.calls[0][0]
			expect(result).toContain("Format: text")
			expect(result).toContain("Hello World")
			expect(result).not.toContain("<script>")
		})

		it("returns html format when requested", async () => {
			const htmlContent = "<html><body>Hello World</body></html>"
			mockFetch.mockResolvedValue({
				ok: true,
				headers: new Map([
					["content-type", "text/html"],
					["content-length", "100"],
				]),
				arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(htmlContent)),
			})

			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com", format: "html" },
				partial: false,
			}

			await webFetchTool.handle(mockTask as Task, block, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
				toolProtocol,
			})

			const result = pushToolResult.mock.calls[0][0]
			expect(result).toContain("Format: html")
			expect(result).toContain(htmlContent)
		})
	})

	describe("handlePartial", () => {
		it("calls task.ask with tool info", async () => {
			const block = {
				type: "tool_use" as const,
				name: "web_fetch" as const,
				params: { url: "https://example.com", format: "markdown" },
				partial: true,
			}

			await webFetchTool.handlePartial(mockTask as Task, block)

			expect(mockTask.ask).toHaveBeenCalledWith("tool", expect.stringContaining('"tool":"webFetch"'), true)
		})
	})
})
