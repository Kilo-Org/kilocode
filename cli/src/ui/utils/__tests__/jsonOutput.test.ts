/**
 * Tests for JSON output formatting utilities
 *
 * This test suite verifies that messages are correctly formatted as JSON
 * for CI mode and other non-interactive output scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { formatMessageAsJson, outputJsonMessage, outputJsonMessages } from "../jsonOutput.js"
import type { UnifiedMessage } from "../../../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { CliMessage } from "../../../types/cli.js"

describe("jsonOutput", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleLogSpy.mockRestore()
	})

	describe("formatMessageAsJson - CLI messages", () => {
		it("should format basic CLI message", () => {
			const cliMessage: CliMessage = {
				ts: 1234567890,
				content: "Hello from CLI",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "cli",
				message: cliMessage,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "cli",
				content: "Hello from CLI",
			})
		})

		it("should handle CLI message with additional properties", () => {
			const cliMessage: CliMessage = {
				ts: 1234567890,
				content: "CLI message",
				type: "info",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "cli",
				message: cliMessage,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "cli",
				content: "CLI message",
				type: "info",
			})
		})
	})

	describe("formatMessageAsJson - Extension messages with JSON content", () => {
		it("should parse valid JSON in text field and move to metadata", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "readFile",
					path: "test.ts",
				}),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				metadata: {
					tool: "readFile",
					path: "test.ts",
				},
			})
			expect(result).not.toHaveProperty("content")
		})

		it("should handle nested JSON structures", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "followup",
				text: JSON.stringify({
					question: "What would you like to do?",
					suggest: [
						{ answer: "Option 1", mode: null },
						{ answer: "Option 2", mode: "code" },
					],
				}),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "followup",
				metadata: {
					question: "What would you like to do?",
					suggest: [
						{ answer: "Option 1", mode: null },
						{ answer: "Option 2", mode: "code" },
					],
				},
			})
		})

		it("should handle JSON arrays", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "codebase_search_result",
				text: JSON.stringify([
					{ file: "test1.ts", line: 10 },
					{ file: "test2.ts", line: 20 },
				]),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "codebase_search_result",
				metadata: [
					{ file: "test1.ts", line: 10 },
					{ file: "test2.ts", line: 20 },
				],
			})
		})

		it("should handle JSON with null values", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "writeFile",
					path: "test.ts",
					content: null,
				}),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				metadata: {
					tool: "writeFile",
					path: "test.ts",
					content: null,
				},
			})
		})

		it("should handle JSON with undefined values (converted to null)", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "readFile",
					path: "test.ts",
					encoding: undefined,
				}),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// undefined values are omitted in JSON.stringify
			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				metadata: {
					tool: "readFile",
					path: "test.ts",
				},
			})
		})
	})

	describe("formatMessageAsJson - Extension messages with plain text", () => {
		it("should keep plain text in content field", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "This is a plain text message",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "This is a plain text message",
			})
			expect(result).not.toHaveProperty("metadata")
		})

		it("should handle error messages with plain text", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "error",
				text: "An error occurred while processing",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "error",
				content: "An error occurred while processing",
			})
		})
	})

	describe("formatMessageAsJson - Malformed JSON handling", () => {
		it("should handle malformed JSON as plain text", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: "{ invalid json",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				content: "{ invalid json",
			})
			expect(result).not.toHaveProperty("metadata")
		})

		it("should handle incomplete JSON objects", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: '{"tool": "readFile", "path":',
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: '{"tool": "readFile", "path":',
			})
		})

		it("should handle JSON with trailing commas", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: '{"tool": "readFile", "path": "test.ts",}',
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// Trailing commas are invalid JSON
			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				content: '{"tool": "readFile", "path": "test.ts",}',
			})
		})
	})

	describe("formatMessageAsJson - Mixed content scenarios", () => {
		it("should handle text that looks like JSON but isn't", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "The config should be {tool: 'readFile', path: 'test.ts'}",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "The config should be {tool: 'readFile', path: 'test.ts'}",
			})
		})

		it("should handle markdown with code blocks containing JSON", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "Here's the config:\n```json\n{\"tool\": \"readFile\"}\n```",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// Should keep as content since it's markdown, not pure JSON
			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "Here's the config:\n```json\n{\"tool\": \"readFile\"}\n```",
			})
		})
	})

	describe("formatMessageAsJson - Empty and edge cases", () => {
		it("should handle empty text field", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
			})
			expect(result).not.toHaveProperty("content")
			expect(result).not.toHaveProperty("metadata")
		})

		it("should handle undefined text field", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
			})
			expect(result).not.toHaveProperty("content")
			expect(result).not.toHaveProperty("metadata")
		})

		it("should handle whitespace-only text", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "   \n\t  ",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "   \n\t  ",
			})
		})
	})

	describe("formatMessageAsJson - Unknown message types", () => {
		it("should handle unknown message type gracefully", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "unknown" as any,
				text: "Unknown message",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "unknown",
				content: "Unknown message",
			})
		})

		it("should handle unknown ask type with JSON content", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "unknown_ask_type" as any,
				text: JSON.stringify({ data: "test" }),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "unknown_ask_type",
				metadata: { data: "test" },
			})
		})

		it("should handle unknown say type with plain text", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "unknown_say_type" as any,
				text: "Some text content",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "unknown_say_type",
				content: "Some text content",
			})
		})
	})

	describe("formatMessageAsJson - Additional message properties", () => {
		it("should preserve images array", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "Message with images",
				images: ["image1.png", "image2.png"],
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "Message with images",
				images: ["image1.png", "image2.png"],
			})
		})

		it("should preserve partial flag", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "Streaming...",
				partial: true,
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "Streaming...",
				partial: true,
			})
		})

		it("should preserve all additional properties", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "completion_result",
				text: "Task completed",
				isAnswered: true,
				conversationHistoryIndex: 5,
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "completion_result",
				content: "Task completed",
				isAnswered: true,
				conversationHistoryIndex: 5,
			})
		})
	})

	describe("outputJsonMessage", () => {
		it("should output formatted message to console", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "Test message",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			outputJsonMessage(unifiedMessage)

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
			expect(output).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "Test message",
			})
		})

		it("should output valid JSON string", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile", path: "test.ts" }),
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			outputJsonMessage(unifiedMessage)

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const outputString = consoleLogSpy.mock.calls[0][0]
			// Should be valid JSON
			expect(() => JSON.parse(outputString)).not.toThrow()
		})
	})

	describe("outputJsonMessages", () => {
		it("should output array of formatted messages", () => {
			const messages: UnifiedMessage[] = [
				{
					source: "extension",
					message: {
						ts: 1234567890,
						type: "say",
						say: "text",
						text: "Message 1",
					},
				},
				{
					source: "extension",
					message: {
						ts: 1234567891,
						type: "say",
						say: "text",
						text: "Message 2",
					},
				},
			]

			outputJsonMessages(messages)

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
			expect(output).toHaveLength(2)
			expect(output[0]).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "Message 1",
			})
			expect(output[1]).toEqual({
				timestamp: 1234567891,
				source: "extension",
				type: "say",
				say: "text",
				content: "Message 2",
			})
		})

		it("should handle empty array", () => {
			outputJsonMessages([])

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
			expect(output).toEqual([])
		})

		it("should handle mixed message types", () => {
			const messages: UnifiedMessage[] = [
				{
					source: "cli",
					message: {
						ts: 1234567890,
						content: "CLI message",
					},
				},
				{
					source: "extension",
					message: {
						ts: 1234567891,
						type: "say",
						say: "text",
						text: JSON.stringify({ data: "test" }),
					},
				},
			]

			outputJsonMessages(messages)

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0][0])
			expect(output).toHaveLength(2)
			expect(output[0]).toEqual({
				timestamp: 1234567890,
				source: "cli",
				content: "CLI message",
			})
			expect(output[1]).toEqual({
				timestamp: 1234567891,
				source: "extension",
				type: "say",
				say: "text",
				metadata: { data: "test" },
			})
		})
	})
})
