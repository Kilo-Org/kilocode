import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderToMarkdown, renderToHtml, renderToJsonl, exportSession } from "../export.js"
import type { UnifiedMessage } from "../../state/atoms/ui.js"
import type { CliMessage } from "../../types/cli.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"

const mockCliMessage = (content: string, type: CliMessage["type"] = "user"): UnifiedMessage => ({
	source: "cli",
	message: {
		id: `cli-${Date.now()}`,
		type,
		content,
		ts: Date.now(),
	},
})

const mockExtensionMessage = (
	text: string,
	sayType: "user_feedback" | "text" | "error" | "completion_result" = "text",
): UnifiedMessage => ({
	source: "extension",
	message: {
		ts: Date.now(),
		type: "say",
		say: sayType,
		text,
	} as ExtensionChatMessage,
})

const mockMetadata = {
	sessionId: "test-session-123",
	title: "Test Session",
	mode: "code",
	provider: "anthropic",
	model: "claude-3-5-sonnet",
	workspace: "/test/workspace",
	exportedAt: new Date().toISOString(),
	messageCount: 3,
}

describe("export utilities", () => {
	describe("renderToMarkdown", () => {
		it("should render messages to markdown format", () => {
			const messages: UnifiedMessage[] = [
				mockCliMessage("Hello, can you help me?", "user"),
				mockExtensionMessage("Of course! How can I assist you?", "text"),
			]

			const result = renderToMarkdown(messages, mockMetadata)

			expect(result).toContain("# Test Session")
			expect(result).toContain("## Metadata")
			expect(result).toContain("**Session ID:** `test-session-123`")
			expect(result).toContain("**Mode:** code")
			expect(result).toContain("## Conversation")
			expect(result).toContain("### User")
			expect(result).toContain("Hello, can you help me?")
			expect(result).toContain("### Assistant")
			expect(result).toContain("Of course! How can I assist you?")
		})

		it("should handle empty messages", () => {
			const result = renderToMarkdown([], mockMetadata)

			expect(result).toContain("# Test Session")
			expect(result).toContain("## Conversation")
		})

		it("should include all metadata fields", () => {
			const result = renderToMarkdown([], mockMetadata)

			expect(result).toContain("**Provider:** anthropic")
			expect(result).toContain("**Model:** claude-3-5-sonnet")
			expect(result).toContain("**Workspace:** `/test/workspace`")
		})
	})

	describe("renderToHtml", () => {
		it("should render messages to HTML format", () => {
			const messages: UnifiedMessage[] = [
				mockCliMessage("Hello", "user"),
				mockExtensionMessage("Hi there!", "text"),
			]

			const result = renderToHtml(messages, mockMetadata)

			expect(result).toContain("<!DOCTYPE html>")
			expect(result).toContain("<title>Test Session</title>")
			expect(result).toContain("<h1>Test Session</h1>")
			expect(result).toContain('class="message user"')
			expect(result).toContain('class="message assistant"')
			expect(result).toContain("Hello")
			expect(result).toContain("Hi there!")
		})

		it("should include proper styling", () => {
			const result = renderToHtml([], mockMetadata)

			expect(result).toContain("<style>")
			expect(result).toContain("--bg-color")
			expect(result).toContain("--user-bg")
			expect(result).toContain("--assistant-bg")
		})

		it("should escape HTML in content", () => {
			const messages: UnifiedMessage[] = [mockCliMessage("<script>alert('xss')</script>", "user")]

			const result = renderToHtml(messages, mockMetadata)

			expect(result).not.toContain("<script>")
			expect(result).toContain("&lt;script&gt;")
		})
	})

	describe("renderToJsonl", () => {
		it("should render messages to JSONL format", () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Hello", "user"), mockExtensionMessage("Hi!", "text")]

			const result = renderToJsonl(messages, mockMetadata)
			const lines = result.split("\n")

			expect(lines).toHaveLength(3)

			const metadataLine = JSON.parse(lines[0]!)
			expect(metadataLine.type).toBe("metadata")
			expect(metadataLine.sessionId).toBe("test-session-123")

			const messageLine1 = JSON.parse(lines[1]!)
			expect(messageLine1.type).toBe("message")
			expect(messageLine1.role).toBe("User")
			expect(messageLine1.content).toBe("Hello")

			const messageLine2 = JSON.parse(lines[2]!)
			expect(messageLine2.type).toBe("message")
			expect(messageLine2.role).toBe("Assistant")
		})

		it("should include source in message lines", () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Hello", "user")]

			const result = renderToJsonl(messages, mockMetadata)
			const lines = result.split("\n")
			const messageLine = JSON.parse(lines[1]!)

			expect(messageLine.source).toBe("cli")
		})
	})

	describe("exportSession", () => {
		const testDir = join(process.cwd(), "test-exports")

		beforeEach(async () => {
			if (existsSync(testDir)) {
				await rm(testDir, { recursive: true })
			}
		})

		afterEach(async () => {
			if (existsSync(testDir)) {
				await rm(testDir, { recursive: true })
			}
		})

		it("should export session to markdown file", async () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Test message", "user")]
			const outputPath = join(testDir, "test-export.md")

			const result = await exportSession(messages, {
				format: "markdown",
				outputPath,
				metadata: { sessionId: "export-test" },
			})

			expect(result.success).toBe(true)
			expect(result.format).toBe("markdown")
			expect(result.outputPath).toBe(outputPath)
			expect(existsSync(outputPath)).toBe(true)
		})

		it("should export session to HTML file", async () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Test message", "user")]
			const outputPath = join(testDir, "test-export.html")

			const result = await exportSession(messages, {
				format: "html",
				outputPath,
				metadata: { sessionId: "export-test" },
			})

			expect(result.success).toBe(true)
			expect(result.format).toBe("html")
			expect(existsSync(outputPath)).toBe(true)
		})

		it("should export session to JSONL file", async () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Test message", "user")]
			const outputPath = join(testDir, "test-export.jsonl")

			const result = await exportSession(messages, {
				format: "jsonl",
				outputPath,
				metadata: { sessionId: "export-test" },
			})

			expect(result.success).toBe(true)
			expect(result.format).toBe("jsonl")
			expect(existsSync(outputPath)).toBe(true)
		})

		it("should create directory if it doesn't exist", async () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Test", "user")]
			const nestedPath = join(testDir, "nested", "deep", "export.md")

			const result = await exportSession(messages, {
				format: "markdown",
				outputPath: nestedPath,
			})

			expect(result.success).toBe(true)
			expect(existsSync(nestedPath)).toBe(true)
		})

		it("should return error on failure", async () => {
			const messages: UnifiedMessage[] = [mockCliMessage("Test", "user")]
			const invalidPath = "/root/no-permission/export.md"

			const result = await exportSession(messages, {
				format: "markdown",
				outputPath: invalidPath,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})
})
