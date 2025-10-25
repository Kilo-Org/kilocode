// npx vitest src/core/assistant-message/kilocode/__tests__/AssistantMessageParser.spec.ts

import { AssistantMessageParser } from "../../AssistantMessageParser"
import { ToolUse } from "../../../../shared/tools"

describe("AssistantMessageParser (streaming)", () => {
	let parser: AssistantMessageParser

	beforeEach(() => {
		parser = new AssistantMessageParser()
	})
	describe("AssistantMessageParser (native tool calls)", () => {
		let parser: AssistantMessageParser

		beforeEach(() => {
			parser = new AssistantMessageParser()
		})

		describe("dynamic MCP tool name handling", () => {
			it("should normalize dynamic MCP tool names to use_mcp_tool", () => {
				const toolCalls = [
					{
						id: "call_123",
						type: "function" as const,
						function: {
							name: "use_mcp_tool___context7___get-library-docs",
							arguments: JSON.stringify({
								toolInputProps: {
									context7CompatibleLibraryID: "/vercel/next.js",
									topic: "routing",
								},
							}),
						},
					},
				]

				parser.processNativeToolCalls(toolCalls)
				const blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(1)
				const toolUse = blocks[0] as ToolUse
				expect(toolUse.type).toBe("tool_use")
				expect(toolUse.name).toBe("use_mcp_tool")
				expect(toolUse.params.server_name).toBe("context7")
				expect(toolUse.params.tool_name).toBe("get-library-docs")
				// Verify arguments contains the toolInputProps as a JSON string
				expect(toolUse.params.arguments).toBeDefined()
				const parsedArgs = JSON.parse(toolUse.params.arguments!)
				expect(parsedArgs.context7CompatibleLibraryID).toBe("/vercel/next.js")
				expect(parsedArgs.topic).toBe("routing")
				expect(toolUse.partial).toBe(false)
			})

			it("should handle dynamic MCP tool names with underscores in tool name", () => {
				const toolCalls = [
					{
						id: "call_456",
						type: "function" as const,
						function: {
							name: "use_mcp_tool___myserver___get_user_data",
							arguments: JSON.stringify({
								toolInputProps: {
									userId: "123",
								},
							}),
						},
					},
				]

				parser.processNativeToolCalls(toolCalls)
				const blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(1)
				const toolUse = blocks[0] as ToolUse
				expect(toolUse.name).toBe("use_mcp_tool")
				expect(toolUse.params.server_name).toBe("myserver")
				expect(toolUse.params.tool_name).toBe("get_user_data")
				// Verify arguments contains the toolInputProps as a JSON string
				const parsedArgs = JSON.parse(toolUse.params.arguments!)
				expect(parsedArgs.userId).toBe("123")
			})

			it("should reject malformed dynamic MCP tool names (no triple underscore separator)", () => {
				const toolCalls = [
					{
						id: "call_789",
						type: "function" as const,
						function: {
							name: "use_mcp_tool___notripleunderscoreseparator",
							arguments: JSON.stringify({}),
						},
					},
				]

				// Mock console.warn to verify it's called
				const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

				parser.processNativeToolCalls(toolCalls)
				const blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(0)
				expect(warnSpy).toHaveBeenCalledWith(
					"[AssistantMessageParser] Unknown tool name in native call:",
					"use_mcp_tool___notripleunderscoreseparator",
				)

				warnSpy.mockRestore()
			})

			it("should handle streaming dynamic MCP tool calls", () => {
				// First delta: function name
				const delta1 = [
					{
						id: "call_stream",
						index: 0,
						type: "function" as const,
						function: {
							name: "use_mcp_tool___weather___get_forecast",
							arguments: "",
						},
					},
				]

				// Second delta: partial arguments (name can be empty string during streaming)
				const delta2 = [
					{
						index: 0,
						type: "function" as const,
						function: {
							name: "",
							arguments: '{"toolInputProps": {"city": "San',
						},
					},
				]

				// Third delta: complete arguments
				const delta3 = [
					{
						index: 0,
						type: "function" as const,
						function: {
							name: "",
							arguments: ' Francisco"}}',
						},
					},
				]

				parser.processNativeToolCalls(delta1)
				let blocks = parser.getContentBlocks()
				expect(blocks).toHaveLength(0) // Not complete yet

				parser.processNativeToolCalls(delta2)
				blocks = parser.getContentBlocks()
				expect(blocks).toHaveLength(0) // Still not complete

				parser.processNativeToolCalls(delta3)
				blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(1)
				const toolUse = blocks[0] as ToolUse
				expect(toolUse.name).toBe("use_mcp_tool")
				expect(toolUse.params.server_name).toBe("weather")
				expect(toolUse.params.tool_name).toBe("get_forecast")
				// Verify arguments contains the toolInputProps as a JSON string
				const parsedArgs = JSON.parse(toolUse.params.arguments!)
				expect(parsedArgs.city).toBe("San Francisco")
			})

			it("should preserve existing server_name and tool_name in params if present", () => {
				const toolCalls = [
					{
						id: "call_preserve",
						type: "function" as const,
						function: {
							name: "use_mcp_tool___server1___tool1",
							arguments: JSON.stringify({
								server_name: "custom_server",
								tool_name: "custom_tool",
								toolInputProps: {
									data: "test",
								},
							}),
						},
					},
				]

				parser.processNativeToolCalls(toolCalls)
				const blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(1)
				const toolUse = blocks[0] as ToolUse
				expect(toolUse.name).toBe("use_mcp_tool")
				// Should preserve the params from arguments, not override with extracted values
				expect(toolUse.params.server_name).toBe("custom_server")
				expect(toolUse.params.tool_name).toBe("custom_tool")
				// Verify arguments contains the toolInputProps as a JSON string
				const parsedArgs = JSON.parse(toolUse.params.arguments!)
				expect(parsedArgs.data).toBe("test")
			})
		})

		describe("standard tool names", () => {
			it("should handle standard tool names without modification", () => {
				const toolCalls = [
					{
						id: "call_standard",
						type: "function" as const,
						function: {
							name: "read_file",
							arguments: JSON.stringify({
								path: "src/file.ts",
							}),
						},
					},
				]

				parser.processNativeToolCalls(toolCalls)
				const blocks = parser.getContentBlocks()

				expect(blocks).toHaveLength(1)
				const toolUse = blocks[0] as ToolUse
				expect(toolUse.name).toBe("read_file")
				expect(toolUse.params.path).toBe("src/file.ts")
			})
		})
	})
})
