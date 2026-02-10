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

	describe("formatMessageAsJson", () => {
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

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "text",
				content: "null",
			})
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

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "ask",
				ask: "tool",
				content: "{ invalid json",
			})
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

			expect(result).toEqual({
				timestamp: 1234567890,
				source: "extension",
				type: "say",
				say: "error",
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
	})
})
