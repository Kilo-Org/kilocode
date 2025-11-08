import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
import { SayMcpServerResponseMessage } from "../SayMcpServerResponseMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"

describe("SayMcpServerResponseMessage", () => {
	it("should render MCP tool response with JSON", () => {
		const jsonResponse = JSON.stringify({
			content: "File contents here",
			mimeType: "text/plain",
		})

		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "filesystem",
				toolName: "read_file",
				response: jsonResponse,
			}),
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		expect(frame).toContain("MCP Tool Response")
		expect(frame).toContain("JSON")
		expect(frame).toContain("File contents here")
		// Should NOT show server/tool (displayed in request instead)
		expect(frame).not.toContain("filesystem")
		expect(frame).not.toContain("read_file")
	})

	it("should render MCP tool response with text", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "shell",
				toolName: "run_command",
				response: "Build completed successfully",
			}),
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		expect(frame).toContain("MCP Tool Response")
		expect(frame).toContain("Build completed successfully")
		// Should NOT show server/tool (displayed in request instead)
		expect(frame).not.toContain("shell")
		expect(frame).not.toContain("run_command")
	})

	it("should handle large response with preview", () => {
		// Create a response with more than 20 lines
		const largeResponse = Array(30)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")

		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "test",
				toolName: "generate",
				response: largeResponse,
			}),
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		// Should show preview indicator
		expect(frame).toContain("more line")
		// Should show first line
		expect(frame).toContain("Line 1")
		// Should NOT show last line (it's in preview mode)
		expect(frame).not.toContain("Line 30")
	})

	it("should display metadata for responses", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "database",
				toolName: "query",
				response: "Result",
			}),
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		// Should show metadata
		expect(frame).toContain("Response")
		expect(frame).toMatch(/\d+ line/)
	})

	it("should handle plain text response (current format)", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: "Error:\nfailed to execute command",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		// Should show the response content
		expect(frame).toContain("MCP Tool Response")
		expect(frame).toContain("Error")
		expect(frame).toContain("failed to execute command")
		// Should NOT show server/tool info (displayed in request message instead)
		expect(frame).not.toContain("Server:")
		expect(frame).not.toContain("Tool:")
	})

	it("should handle empty message text", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: "",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		expect(frame).toContain("No data")
	})

	it("should format JSON response with proper indentation", () => {
		const jsonResponse = JSON.stringify({ key: "value", nested: { data: 123 } })

		const message: ExtensionChatMessage = {
			type: "say",
			say: "mcp_server_response",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "api",
				toolName: "fetch",
				response: jsonResponse,
			}),
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayMcpServerResponseMessage message={message} />)
		const frame = lastFrame()

		// Should contain formatted JSON (with indentation)
		expect(frame).toContain("key")
		expect(frame).toContain("value")
		expect(frame).toContain("nested")
	})
})
