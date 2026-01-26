// npx vitest run packages/core/src/message-utils/__tests__/consolidateCommands.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { consolidateCommands, COMMAND_OUTPUT_STRING } from "../consolidateCommands.js"

describe("consolidateCommands", () => {
	describe("command sequences", () => {
		it("should consolidate command and command_output messages", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "file1.txt", ts: 1001 },
				{ type: "ask", ask: "command_output", text: "file2.txt", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("command")
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}file1.txt\nfile2.txt`)
		})

		it("should handle multiple command sequences", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "output1", ts: 1001 },
				{ type: "ask", ask: "command", text: "pwd", ts: 1002 },
				{ type: "ask", ask: "command_output", text: "output2", ts: 1003 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(2)
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}output1`)
			expect(result[1]!.text).toBe(`pwd\n${COMMAND_OUTPUT_STRING}output2`)
		})

		it("should handle command without output", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "say", say: "text", text: "some text", ts: 1001 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(2)
			expect(result[0]!.ask).toBe("command")
			expect(result[0]!.text).toBe("ls")
			expect(result[1]!.say).toBe("text")
		})

		it("should handle duplicate outputs (ask and say with same text)", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "same output", ts: 1001 },
				{ type: "say", say: "command_output", text: "same output", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}same output`)
		})
	})

	describe("MCP server sequences", () => {
		it("should consolidate use_mcp_server and mcp_server_response messages", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test", tool: "myTool" }),
					ts: 1000,
				},
				{ type: "say", say: "mcp_server_response", text: "response data", ts: 1001 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("use_mcp_server")
			const parsed = JSON.parse(result[0]!.text || "{}")
			expect(parsed.server).toBe("test")
			expect(parsed.response).toBe("response data")
		})

		it("should handle MCP request without response", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test" }),
					ts: 1000,
				},
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("use_mcp_server")
		})

		it("should handle multiple MCP responses", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test" }),
					ts: 1000,
				},
				{ type: "say", say: "mcp_server_response", text: "response1", ts: 1001 },
				{ type: "say", say: "mcp_server_response", text: "response2", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			const parsed = JSON.parse(result[0]!.text || "{}")
			expect(parsed.response).toBe("response1\nresponse2")
		})
	})

	describe("mixed messages", () => {
		it("should preserve non-command, non-MCP messages", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "before", ts: 1000 },
				{ type: "ask", ask: "command", text: "ls", ts: 1001 },
				{ type: "ask", ask: "command_output", text: "output", ts: 1002 },
				{ type: "say", say: "text", text: "after", ts: 1003 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(3)
			expect(result[0]!.text).toBe("before")
			expect(result[1]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}output`)
			expect(result[2]!.text).toBe("after")
		})

		it("should handle empty array", () => {
			const result = consolidateCommands([])
			expect(result).toEqual([])
		})
	})
})
