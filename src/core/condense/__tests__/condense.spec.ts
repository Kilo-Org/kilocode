// npx vitest src/core/condense/__tests__/condense.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	summarizeConversation,
	getMessagesSinceLastSummary,
	getEffectiveApiHistory,
	extractCommandBlocks,
} from "../index"

// Create a mock ApiHandler for testing
class MockApiHandler extends BaseProvider {
	createMessage(): any {
		// Mock implementation for testing - returns an async iterable stream
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
		// Simple token counting for testing
		let tokens = 0
		for (const block of content) {
			if (block.type === "text") {
				tokens += Math.ceil(block.text.length / 4) // Rough approximation
			}
		}
		return tokens
	}
}

const mockApiHandler = new MockApiHandler()
const taskId = "test-task-id"

describe("Condense", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	describe("extractCommandBlocks", () => {
		it("should extract command blocks from string content", () => {
			const message: ApiMessage = {
				role: "user",
				content: 'Some text <command name="prr">/prr #123</command> more text',
			}

			const result = extractCommandBlocks(message)
			expect(result).toBe('<command name="prr">/prr #123</command>')
		})

		it("should extract multiple command blocks", () => {
			const message: ApiMessage = {
				role: "user",
				content: '<command name="prr">/prr #123</command> text <command name="mode">/mode code</command>',
			}

			const result = extractCommandBlocks(message)
			expect(result).toBe('<command name="prr">/prr #123</command>\n<command name="mode">/mode code</command>')
		})

		it("should extract command blocks from array content", () => {
			const message: ApiMessage = {
				role: "user",
				content: [
					{ type: "text", text: "Some user text" },
					{ type: "text", text: '<command name="prr">Help content</command>' },
				],
			}

			const result = extractCommandBlocks(message)
			expect(result).toBe('<command name="prr">Help content</command>')
		})

		it("should return empty string when no command blocks found", () => {
			const message: ApiMessage = {
				role: "user",
				content: "Just regular text without commands",
			}

			const result = extractCommandBlocks(message)
			expect(result).toBe("")
		})

		it("should handle multiline command blocks", () => {
			const message: ApiMessage = {
				role: "user",
				content: `<command name="prr">
Line 1
Line 2
</command>`,
			}

			const result = extractCommandBlocks(message)
			expect(result).toContain("Line 1")
			expect(result).toContain("Line 2")
		})
	})

	describe("summarizeConversation", () => {
		it("should create a summary message with role user (fresh start model)", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /prr command content" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
				{ role: "assistant", content: "Sixth message" },
				{ role: "user", content: "Seventh message" },
				{ role: "assistant", content: "Eighth message" },
				{ role: "user", content: "Ninth message" },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			// Verify we have a summary message with role "user" (fresh start model)
			const summaryMessage = result.messages.find((msg) => msg.isSummary)
			expect(summaryMessage).toBeTruthy()
			expect(summaryMessage!.role).toBe("user")
			expect(Array.isArray(summaryMessage!.content)).toBe(true)
			const contentArray = summaryMessage!.content as any[]
			expect(contentArray.some((b) => b.type === "text")).toBe(true)
			// Should NOT have reasoning blocks (no longer needed for user messages)
			expect(contentArray.some((b) => b.type === "reasoning")).toBe(false)

			// Fresh start model: effective history should only contain the summary
			const effectiveHistory = getEffectiveApiHistory(result.messages)
			expect(effectiveHistory.length).toBe(1)
			expect(effectiveHistory[0].isSummary).toBe(true)
			expect(effectiveHistory[0].role).toBe("user")
		})

		it("should tag ALL messages with condenseParent", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /prr command content" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			// All original messages should be tagged with condenseParent
			const taggedMessages = result.messages.filter((msg) => !msg.isSummary)
			expect(taggedMessages.length).toBe(messages.length)
			for (const msg of taggedMessages) {
				expect(msg.condenseParent).toBeDefined()
			}
		})

		it("should preserve <command> blocks in the summary", async () => {
			const messages: ApiMessage[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Some user text" },
						{ type: "text", text: '<command name="prr">Help content</command>' },
					],
				},
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
				{ role: "assistant", content: "Fourth message" },
				{ role: "user", content: "Fifth message" },
				{ role: "assistant", content: "Sixth message" },
				{ role: "user", content: "Seventh message" },
				{ role: "assistant", content: "Eighth message" },
				{ role: "user", content: "Ninth message" },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			const summaryMessage = result.messages.find((msg) => msg.isSummary)
			expect(summaryMessage).toBeTruthy()

			const contentArray = summaryMessage!.content as any[]
			// Summary content is split into separate text blocks:
			// - First block: "## Conversation Summary\n..."
			// - Second block: "<system-reminder>..." with command blocks
			expect(contentArray).toHaveLength(2)
			expect(contentArray[0].text).toContain("## Conversation Summary")
			expect(contentArray[1].text).toContain('<command name="prr">')
			expect(contentArray[1].text).toContain("<system-reminder>")
			expect(contentArray[1].text).toContain("Active Workflows")
		})

		it("should handle complex first message content", async () => {
			const complexContent: Anthropic.Messages.ContentBlockParam[] = [
				{ type: "text", text: "/mode code" },
				{ type: "text", text: "Additional context from the user" },
			]

			const messages: ApiMessage[] = [
				{ role: "user", content: complexContent },
				{ role: "assistant", content: "Switching to code mode" },
				{ role: "user", content: "Write a function" },
				{ role: "assistant", content: "Here's the function" },
				{ role: "user", content: "Add error handling" },
				{ role: "assistant", content: "Added error handling" },
				{ role: "user", content: "Add tests" },
				{ role: "assistant", content: "Tests added" },
				{ role: "user", content: "Perfect!" },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			// Effective history should contain only the summary (fresh start)
			const effectiveHistory = getEffectiveApiHistory(result.messages)
			expect(effectiveHistory).toHaveLength(1)
			expect(effectiveHistory[0].isSummary).toBe(true)
			expect(effectiveHistory[0].role).toBe("user")
		})

		it("should return error when not enough messages to summarize", async () => {
			const messages: ApiMessage[] = [{ role: "user", content: "Only one message" }]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			// Should return an error since we have only 1 message
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages) // Original messages unchanged
			expect(result.summary).toBe("")
		})

		it("should not summarize messages that already contain a recent summary with no new messages", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message with /command" },
				{ role: "user", content: "Previous summary", isSummary: true },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			// Should return an error due to recent summary with no substantial messages after
			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.summary).toBe("")
		})

		it("should handle empty summary from API gracefully", async () => {
			// Mock handler that returns empty summary
			class EmptyMockApiHandler extends MockApiHandler {
				override createMessage(): any {
					const mockStream = {
						async *[Symbol.asyncIterator]() {
							yield { type: "text", text: "" }
							yield { type: "usage", inputTokens: 100, outputTokens: 0, totalCost: 0.01 }
						},
					}
					return mockStream
				}
			}

			const emptyHandler = new EmptyMockApiHandler()
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second" },
				{ role: "user", content: "Third" },
				{ role: "assistant", content: "Fourth" },
				{ role: "user", content: "Fifth" },
				{ role: "assistant", content: "Sixth" },
				{ role: "user", content: "Seventh" },
			]

			const result = await summarizeConversation({
				messages,
				apiHandler: emptyHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: false,
			})

			expect(result.error).toBeDefined()
			expect(result.messages).toEqual(messages)
			expect(result.cost).toBeGreaterThan(0)
		})
	})

	describe("getEffectiveApiHistory", () => {
		it("should return only summary when summary exists (fresh start)", () => {
			const condenseId = "test-condense-id"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First", condenseParent: condenseId },
				{ role: "assistant", content: "Second", condenseParent: condenseId },
				{ role: "user", content: "Third", condenseParent: condenseId },
				{
					role: "user",
					content: [{ type: "text", text: "Summary content" }],
					isSummary: true,
					condenseId,
				},
			]

			const result = getEffectiveApiHistory(messages)

			expect(result).toHaveLength(1)
			expect(result[0].isSummary).toBe(true)
		})

		it("should include messages after summary in fresh start model", () => {
			const condenseId = "test-condense-id"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First", condenseParent: condenseId },
				{ role: "assistant", content: "Second", condenseParent: condenseId },
				{
					role: "user",
					content: [{ type: "text", text: "Summary content" }],
					isSummary: true,
					condenseId,
				},
				{ role: "assistant", content: "New response after summary" },
				{ role: "user", content: "New user message" },
			]

			const result = getEffectiveApiHistory(messages)

			expect(result).toHaveLength(3)
			expect(result[0].isSummary).toBe(true)
			expect(result[1].content).toBe("New response after summary")
			expect(result[2].content).toBe("New user message")
		})

		it("should return all messages when no summary exists", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First" },
				{ role: "assistant", content: "Second" },
				{ role: "user", content: "Third" },
			]

			const result = getEffectiveApiHistory(messages)

			expect(result).toEqual(messages)
		})

		it("should restore messages when summary is deleted (rewind)", () => {
			// After rewind, summary is deleted but condenseParent tags remain as orphans
			// The cleanupAfterTruncation function would normally clear these,
			// but even without cleanup, getEffectiveApiHistory should handle orphaned tags
			const orphanedCondenseId = "deleted-summary-id"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First", condenseParent: orphanedCondenseId },
				{ role: "assistant", content: "Second", condenseParent: orphanedCondenseId },
				{ role: "user", content: "Third", condenseParent: orphanedCondenseId },
				// Summary was deleted - no isSummary message exists
			]

			const result = getEffectiveApiHistory(messages)

			// With no summary, all messages should be included (orphaned condenseParent is ignored)
			expect(result).toHaveLength(3)
		})
	})

	describe("getMessagesSinceLastSummary", () => {
		it("should return all messages when no summary exists", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Third message" },
			]

			const result = getMessagesSinceLastSummary(messages)
			expect(result).toEqual(messages)
		})

		it("should return messages since last summary including the summary", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "Second message" },
				{ role: "user", content: "Summary content", isSummary: true },
				{ role: "assistant", content: "Message after summary" },
				{ role: "user", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			expect(result[0]).toEqual(messages[2]) // The summary
			expect(result[1]).toEqual(messages[3])
			expect(result[2]).toEqual(messages[4])
		})

		it("should handle multiple summaries and return from the last one", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message" },
				{ role: "user", content: "First summary", isSummary: true },
				{ role: "assistant", content: "Middle message" },
				{ role: "user", content: "Second summary", isSummary: true },
				{ role: "assistant", content: "Recent message" },
				{ role: "user", content: "Final message" },
			]

			const result = getMessagesSinceLastSummary(messages)

			expect(result[0]).toEqual(messages[3]) // Second summary
			expect(result[1]).toEqual(messages[4])
			expect(result[2]).toEqual(messages[5])
		})
	})
})
