/**
 * Tests for JSON output formatting utilities
 *
 * This test suite verifies that messages are correctly formatted as JSON
 * for CI mode and other non-interactive output scenarios.
 *
 * Schema v1.0.0 adds: schemaVersion, messageId, event, status
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { JSON_SCHEMA_VERSION } from "@kilocode/core-schemas"
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

	describe("formatMessageAsJson", () => {
		it("should format basic CLI message with schema v1.0.0 fields", () => {
			const cliMessage: CliMessage = {
				id: "test-id",
				type: "assistant",
				ts: 1234567890,
				content: "Hello from CLI",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "cli",
				message: cliMessage,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// Verify v1.0.0 schema fields
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^cli-1234567890-/)
			expect(result.event).toBe("assistant.message")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("cli")
			expect(result.content).toBe("Hello from CLI")
		})

		it("should set status to partial for partial CLI messages", () => {
			const cliMessage: CliMessage = {
				id: "test-id",
				type: "assistant",
				ts: 1234567890,
				content: "Hello",
				partial: true,
			}

			const unifiedMessage: UnifiedMessage = {
				source: "cli",
				message: cliMessage,
			}

			const result = formatMessageAsJson(unifiedMessage)
			expect(result.status).toBe("partial")
		})

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

			// Verify v1.0.0 schema fields
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^ext-1234567890-/)
			expect(result.event).toBe("tool.request")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("extension")
			expect(result.type).toBe("ask")
			expect(result.ask).toBe("tool")
			expect(result.metadata).toEqual({
				tool: "readFile",
				path: "test.ts",
			})
			expect(result).not.toHaveProperty("content")
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

			// Verify v1.0.0 schema fields are present
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^ext-/)
			expect(result.event).toBe("assistant.message")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("extension")
			expect(result.type).toBe("say")
			expect(result.say).toBe("codebase_search_result")
			expect(result.metadata).toEqual([
				{ file: "test1.ts", line: 10 },
				{ file: "test2.ts", line: 20 },
			])
		})

		it("should keep JSON primitives as content", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "text",
				text: "null",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// Verify v1.0.0 schema fields
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^ext-/)
			expect(result.event).toBe("assistant.message")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("extension")
			expect(result.type).toBe("say")
			expect(result.say).toBe("text")
			expect(result.content).toBe("null")
		})

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

			// Verify v1.0.0 schema fields
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^ext-/)
			expect(result.event).toBe("tool.request")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("extension")
			expect(result.type).toBe("ask")
			expect(result.ask).toBe("tool")
			expect(result.content).toBe("{ invalid json")
			expect(result).not.toHaveProperty("metadata")
		})

		it("should omit content/metadata for empty or missing text", () => {
			const message: ExtensionChatMessage = {
				ts: 1234567890,
				type: "say",
				say: "error",
			}

			const unifiedMessage: UnifiedMessage = {
				source: "extension",
				message,
			}

			const result = formatMessageAsJson(unifiedMessage)

			// Verify v1.0.0 schema fields
			expect(result.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(result.messageId).toMatch(/^ext-/)
			expect(result.event).toBe("system.error")
			expect(result.status).toBe("complete")

			// Verify backward-compatible fields
			expect(result.timestamp).toBe(1234567890)
			expect(result.source).toBe("extension")
			expect(result.type).toBe("say")
			expect(result.say).toBe("error")
			expect(result).not.toHaveProperty("content")
			expect(result).not.toHaveProperty("metadata")
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

			// Verify v1.0.0 schema fields
			expect(output.schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(output.messageId).toMatch(/^ext-/)
			expect(output.event).toBe("assistant.message")
			expect(output.status).toBe("complete")

			// Verify backward-compatible fields
			expect(output.timestamp).toBe(1234567890)
			expect(output.source).toBe("extension")
			expect(output.type).toBe("say")
			expect(output.say).toBe("text")
			expect(output.content).toBe("Test message")
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

			// Verify first message has v1.0.0 schema fields
			expect(output[0].schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(output[0].messageId).toMatch(/^ext-/)
			expect(output[0].event).toBe("assistant.message")
			expect(output[0].status).toBe("complete")
			expect(output[0].timestamp).toBe(1234567890)
			expect(output[0].source).toBe("extension")
			expect(output[0].type).toBe("say")
			expect(output[0].say).toBe("text")
			expect(output[0].content).toBe("Message 1")

			// Verify second message
			expect(output[1].schemaVersion).toBe(JSON_SCHEMA_VERSION)
			expect(output[1].messageId).toMatch(/^ext-/)
			expect(output[1].timestamp).toBe(1234567891)
			expect(output[1].content).toBe("Message 2")
		})
	})
})
