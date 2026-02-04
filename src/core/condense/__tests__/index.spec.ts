// npx vitest core/condense/__tests__/index.spec.ts

import type { Mock } from "vitest"

import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandler } from "../../../api"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../../api/transform/image-cleaning"
import {
	summarizeConversation,
	getMessagesSinceLastSummary,
	getEffectiveApiHistory,
	cleanupAfterTruncation,
	extractCommandBlocks,
	injectSyntheticToolResults,
	toolUseToText,
	toolResultToText,
	convertToolBlocksToText,
	transformMessagesForCondensing,
} from "../index"

vi.mock("../../../api/transform/image-cleaning", () => ({
	maybeRemoveImageBlocks: vi.fn((messages: ApiMessage[], _apiHandler: ApiHandler) => [...messages]),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureContextCondensed: vi.fn(),
		},
	},
}))

const taskId = "test-task-id"

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

	it("should handle command blocks with attributes", () => {
		const message: ApiMessage = {
			role: "user",
			content: '<command name="test" attr1="value1" attr2="value2">content</command>',
		}

		const result = extractCommandBlocks(message)
		expect(result).toContain('name="test"')
		expect(result).toContain('attr1="value1"')
	})
})

describe("injectSyntheticToolResults", () => {
	it("should return messages unchanged when no orphan tool_calls exist", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "test.ts" } }],
				ts: 2,
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file contents" }],
				ts: 3,
			},
		]

		const result = injectSyntheticToolResults(messages)
		expect(result).toEqual(messages)
	})

	it("should inject synthetic tool_result for orphan tool_call", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-orphan", name: "attempt_completion", input: { result: "Done" } },
				],
				ts: 2,
			},
			// No tool_result for tool-orphan
		]

		const result = injectSyntheticToolResults(messages)

		expect(result.length).toBe(3)
		expect(result[2].role).toBe("user")

		const content = result[2].content as any[]
		expect(content.length).toBe(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].tool_use_id).toBe("tool-orphan")
		expect(content[0].content).toBe("Context condensation triggered. Tool execution deferred.")
	})

	it("should inject synthetic tool_results for multiple orphan tool_calls", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "test.ts" } },
					{ type: "tool_use", id: "tool-2", name: "write_file", input: { path: "out.ts", content: "code" } },
				],
				ts: 2,
			},
			// No tool_results for either
		]

		const result = injectSyntheticToolResults(messages)

		expect(result.length).toBe(3)
		const content = result[2].content as any[]
		expect(content.length).toBe(2)
		expect(content[0].tool_use_id).toBe("tool-1")
		expect(content[1].tool_use_id).toBe("tool-2")
	})

	it("should only inject for orphan tool_calls, not matched ones", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "matched-tool", name: "read_file", input: { path: "test.ts" } },
					{ type: "tool_use", id: "orphan-tool", name: "attempt_completion", input: { result: "Done" } },
				],
				ts: 2,
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "matched-tool", content: "file contents" }],
				ts: 3,
			},
			// No tool_result for orphan-tool
		]

		const result = injectSyntheticToolResults(messages)

		expect(result.length).toBe(4)
		const syntheticContent = result[3].content as any[]
		expect(syntheticContent.length).toBe(1)
		expect(syntheticContent[0].tool_use_id).toBe("orphan-tool")
	})

	it("should handle messages with string content (no tool_use/tool_result)", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there!", ts: 2 },
		]

		const result = injectSyntheticToolResults(messages)
		expect(result).toEqual(messages)
	})

	it("should handle empty messages array", () => {
		const result = injectSyntheticToolResults([])
		expect(result).toEqual([])
	})

	it("should handle tool_results spread across multiple user messages", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "a.ts" } },
					{ type: "tool_use", id: "tool-2", name: "read_file", input: { path: "b.ts" } },
				],
				ts: 2,
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: "contents a" }],
				ts: 3,
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-2", content: "contents b" }],
				ts: 4,
			},
		]

		const result = injectSyntheticToolResults(messages)
		// Both tool_uses have matching tool_results, no injection needed
		expect(result).toEqual(messages)
	})
})

describe("getMessagesSinceLastSummary", () => {
	it("should return all messages when there is no summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual(messages)
	})

	it("should return messages since the last summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "assistant", content: "How are you?", ts: 4 },
			{ role: "user", content: "I'm good", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "assistant", content: "How are you?", ts: 4 },
			{ role: "user", content: "I'm good", ts: 5 },
		])
	})

	it("should handle multiple summary messages and return since the last one", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "user", content: "First summary", ts: 2, isSummary: true },
			{ role: "assistant", content: "How are you?", ts: 3 },
			{ role: "user", content: "Second summary", ts: 4, isSummary: true },
			{ role: "assistant", content: "What's new?", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Second summary", ts: 4, isSummary: true },
			{ role: "assistant", content: "What's new?", ts: 5 },
		])
	})

	it("should handle empty messages array", () => {
		const result = getMessagesSinceLastSummary([])
		expect(result).toEqual([])
	})

	it("should return messages from user summary (fresh start model)", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1, condenseParent: "cond-1" },
			{ role: "assistant", content: "Hi there", ts: 2, condenseParent: "cond-1" },
			{ role: "user", content: "Summary content", ts: 3, isSummary: true, condenseId: "cond-1" },
			{ role: "assistant", content: "Response after summary", ts: 4 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result[0].isSummary).toBe(true)
		expect(result[0].role).toBe("user")
	})
})

describe("getEffectiveApiHistory", () => {
	it("should return only summary when summary exists (fresh start model)", () => {
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

	it("should restore messages when summary is deleted (rewind - orphaned condenseParent)", () => {
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

	it("should filter out truncated messages within summary range", () => {
		const condenseId = "cond-1"
		const truncationId = "trunc-1"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", condenseParent: condenseId },
			{
				role: "user",
				content: [{ type: "text", text: "Summary" }],
				isSummary: true,
				condenseId,
			},
			{ role: "assistant", content: "Response", truncationParent: truncationId },
			{
				role: "assistant",
				content: [{ type: "text", text: "..." }],
				isTruncationMarker: true,
				truncationId,
			},
			{ role: "user", content: "After truncation" },
		]

		const result = getEffectiveApiHistory(messages)

		// Summary + truncation marker + after truncation (the truncated response is filtered out)
		expect(result).toHaveLength(3)
		expect(result[0].isSummary).toBe(true)
		expect(result[1].isTruncationMarker).toBe(true)
		expect(result[2].content).toBe("After truncation")
	})

	it("should filter out orphan tool_result blocks after fresh start condensation", () => {
		const condenseId = "cond-1"
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", condenseParent: condenseId },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-orphan", name: "attempt_completion", input: { result: "Done" } },
				],
				condenseParent: condenseId,
			},
			// Summary comes after the tool_use (so tool_use is condensed away)
			{
				role: "user",
				content: [{ type: "text", text: "Summary content" }],
				isSummary: true,
				condenseId,
			},
			// This tool_result references a tool_use that was condensed away (orphan!)
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-orphan", content: "Rejected by user" }],
			},
		]

		const result = getEffectiveApiHistory(messages)

		// Should only return the summary, orphan tool_result message should be filtered out
		expect(result).toHaveLength(1)
		expect(result[0].isSummary).toBe(true)
	})

	it("should keep tool_result blocks that have matching tool_use in fresh start", () => {
		const condenseId = "cond-1"
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", condenseParent: condenseId },
			{
				role: "user",
				content: [{ type: "text", text: "Summary content" }],
				isSummary: true,
				condenseId,
			},
			// This tool_use is AFTER the summary, so it's not condensed away
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-valid", name: "read_file", input: { path: "test.ts" } }],
			},
			// This tool_result has a matching tool_use, so it should be kept
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-valid", content: "file contents" }],
			},
		]

		const result = getEffectiveApiHistory(messages)

		// All messages after summary should be included
		expect(result).toHaveLength(3)
		expect(result[0].isSummary).toBe(true)
		expect((result[1].content as any[])[0].id).toBe("tool-valid")
		expect((result[2].content as any[])[0].tool_use_id).toBe("tool-valid")
	})

	it("should filter orphan tool_results but keep other content in mixed user message", () => {
		const condenseId = "cond-1"
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", condenseParent: condenseId },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-orphan", name: "attempt_completion", input: { result: "Done" } },
				],
				condenseParent: condenseId,
			},
			{
				role: "user",
				content: [{ type: "text", text: "Summary content" }],
				isSummary: true,
				condenseId,
			},
			// This tool_use is AFTER the summary
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-valid", name: "read_file", input: { path: "test.ts" } }],
			},
			// Mixed content: one orphan tool_result and one valid tool_result
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "tool-orphan", content: "Orphan result" },
					{ type: "tool_result", tool_use_id: "tool-valid", content: "Valid result" },
				],
			},
		]

		const result = getEffectiveApiHistory(messages)

		// Summary + assistant with tool_use + filtered user message
		expect(result).toHaveLength(3)
		expect(result[0].isSummary).toBe(true)
		// The user message should only contain the valid tool_result
		const userContent = result[2].content as any[]
		expect(userContent).toHaveLength(1)
		expect(userContent[0].tool_use_id).toBe("tool-valid")
	})

	it("should handle multiple orphan tool_results in a single message", () => {
		const condenseId = "cond-1"
		const messages: ApiMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "orphan-1", name: "read_file", input: { path: "a.ts" } },
					{ type: "tool_use", id: "orphan-2", name: "write_file", input: { path: "b.ts", content: "code" } },
				],
				condenseParent: condenseId,
			},
			{
				role: "user",
				content: [{ type: "text", text: "Summary content" }],
				isSummary: true,
				condenseId,
			},
			// Multiple orphan tool_results - entire message should be removed
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "orphan-1", content: "Result 1" },
					{ type: "tool_result", tool_use_id: "orphan-2", content: "Result 2" },
				],
			},
		]

		const result = getEffectiveApiHistory(messages)

		// Only summary should remain
		expect(result).toHaveLength(1)
		expect(result[0].isSummary).toBe(true)
	})

	it("should preserve non-tool_result content in user messages", () => {
		const condenseId = "cond-1"
		const messages: ApiMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool-orphan", name: "attempt_completion", input: { result: "Done" } },
				],
				condenseParent: condenseId,
			},
			{
				role: "user",
				content: [{ type: "text", text: "Summary content" }],
				isSummary: true,
				condenseId,
			},
			// User message with text content and orphan tool_result
			{
				role: "user",
				content: [
					{ type: "text", text: "User added some text" },
					{ type: "tool_result", tool_use_id: "tool-orphan", content: "Orphan result" },
				],
			},
		]

		const result = getEffectiveApiHistory(messages)

		// Summary + user message with only text (orphan tool_result filtered)
		expect(result).toHaveLength(2)
		expect(result[0].isSummary).toBe(true)
		const userContent = result[1].content as any[]
		expect(userContent).toHaveLength(1)
		expect(userContent[0].type).toBe("text")
		expect(userContent[0].text).toBe("User added some text")
	})
})

describe("cleanupAfterTruncation", () => {
	it("should clear orphaned condenseParent references", () => {
		const orphanedCondenseId = "deleted-summary"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", condenseParent: orphanedCondenseId },
			{ role: "assistant", content: "Second", condenseParent: orphanedCondenseId },
			{ role: "user", content: "Third" },
		]

		const result = cleanupAfterTruncation(messages)

		expect(result[0].condenseParent).toBeUndefined()
		expect(result[1].condenseParent).toBeUndefined()
		expect(result[2].condenseParent).toBeUndefined()
	})

	it("should keep condenseParent when summary still exists", () => {
		const condenseId = "existing-summary"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", condenseParent: condenseId },
			{ role: "assistant", content: "Second", condenseParent: condenseId },
			{
				role: "user",
				content: [{ type: "text", text: "Summary" }],
				isSummary: true,
				condenseId,
			},
		]

		const result = cleanupAfterTruncation(messages)

		expect(result[0].condenseParent).toBe(condenseId)
		expect(result[1].condenseParent).toBe(condenseId)
	})

	it("should clear orphaned truncationParent references", () => {
		const orphanedTruncationId = "deleted-truncation"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", truncationParent: orphanedTruncationId },
			{ role: "assistant", content: "Second" },
		]

		const result = cleanupAfterTruncation(messages)

		expect(result[0].truncationParent).toBeUndefined()
	})

	it("should keep truncationParent when marker still exists", () => {
		const truncationId = "existing-truncation"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", truncationParent: truncationId },
			{
				role: "assistant",
				content: [{ type: "text", text: "..." }],
				isTruncationMarker: true,
				truncationId,
			},
		]

		const result = cleanupAfterTruncation(messages)

		expect(result[0].truncationParent).toBe(truncationId)
	})

	it("should handle mixed orphaned and valid references", () => {
		const validCondenseId = "valid-cond"
		const orphanedCondenseId = "orphaned-cond"
		const messages: ApiMessage[] = [
			{ role: "user", content: "First", condenseParent: orphanedCondenseId },
			{ role: "assistant", content: "Second", condenseParent: validCondenseId },
			{
				role: "user",
				content: [{ type: "text", text: "Summary" }],
				isSummary: true,
				condenseId: validCondenseId,
			},
		]

		const result = cleanupAfterTruncation(messages)

		expect(result[0].condenseParent).toBeUndefined() // orphaned, cleared
		expect(result[1].condenseParent).toBe(validCondenseId) // valid, kept
	})
})

describe("summarizeConversation", () => {
	// Mock ApiHandler
	let mockApiHandler: ApiHandler
	let mockStream: AsyncGenerator<any, void, unknown>

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup mock stream with usage information
		mockStream = (async function* () {
			yield { type: "text" as const, text: "This is " }
			yield { type: "text" as const, text: "a summary" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 150 }
		})()

		// Setup mock API handler
		mockApiHandler = {
			createMessage: vi.fn().mockReturnValue(mockStream),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(100)),
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler
	})

	// Default system prompt for tests
	const defaultSystemPrompt = "You are a helpful assistant."

	it("should not summarize when there are not enough messages", async () => {
		const messages: ApiMessage[] = [{ role: "user", content: "Hello", ts: 1 }]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy() // Error should be set for not enough messages
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should create summary with user role (fresh start model)", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Check that the API was called correctly
		expect(mockApiHandler.createMessage).toHaveBeenCalled()
		expect(maybeRemoveImageBlocks).toHaveBeenCalled()

		// Result contains all original messages (tagged) plus summary at end
		expect(result.messages.length).toBe(messages.length + 1)

		// All original messages should be tagged with condenseParent
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		const condenseId = summaryMessage!.condenseId
		expect(condenseId).toBeDefined()
		for (const msg of result.messages.filter((m) => !m.isSummary)) {
			expect(msg.condenseParent).toBe(condenseId)
		}

		// Summary message is a user message with just text (fresh start model)
		expect(summaryMessage!.role).toBe("user")
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(1)
		expect(content[0].type).toBe("text")
		expect(content[0].text).toContain("## Conversation Summary")
		expect(content[0].text).toContain("This is a summary")

		// Fresh start: effective API history should contain only the summary
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory).toHaveLength(1)
		expect(effectiveHistory[0].isSummary).toBe(true)
		expect(effectiveHistory[0].role).toBe("user")

		// Check the cost and token counts
		expect(result.cost).toBe(0.05)
		expect(result.summary).toBe("This is a summary")
		// newContextTokens = countTokens(systemPrompt + summaryMessage) - counts actual content, not outputTokens
		expect(result.newContextTokens).toBe(100) // countTokens mock returns 100
		expect(result.error).toBeUndefined()
	})

	it("should preserve command blocks from first message in summary", async () => {
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: 'Hello <command name="prr">/prr #123</command>',
				ts: 1,
			},
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()

		const content = summaryMessage!.content as any[]
		// Summary content is now split into separate text blocks
		expect(content).toHaveLength(2)
		expect(content[0].text).toContain("## Conversation Summary")
		expect(content[1].text).toContain("<system-reminder>")
		expect(content[1].text).toContain("Active Workflows")
		expect(content[1].text).toContain('<command name="prr">')
	})

	it("should not include command blocks wrapper when no commands in first message", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()

		const content = summaryMessage!.content as any[]
		expect(content[0].text).not.toContain("<system-reminder>")
		expect(content[0].text).not.toContain("Active Workflows")
	})

	it("should handle empty summary response and return error", async () => {
		// We need enough messages to trigger summarization
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Setup empty summary response with usage information
		const emptyStream = (async function* () {
			yield { type: "text" as const, text: "" }
			yield { type: "usage" as const, totalCost: 0.02, outputTokens: 0 }
		})()

		// Create a new mock for createMessage that returns empty stream
		const createMessageMock = vi.fn().mockReturnValue(emptyStream)
		mockApiHandler.createMessage = createMessageMock as any

		// We need to mock maybeRemoveImageBlocks to return the expected messages
		;(maybeRemoveImageBlocks as Mock).mockImplementationOnce((messages: any) => {
			return messages.map(({ role, content }: { role: string; content: any }) => ({ role, content }))
		})

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Should return original messages when summary is empty
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0.02)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
	})

	it("should correctly format the request to the API", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Verify that createMessage was called with the SUMMARY_PROMPT (which contains CRITICAL instructions), messages array, and optional metadata
		expect(mockApiHandler.createMessage).toHaveBeenCalledWith(
			expect.stringContaining("You are a helpful AI assistant tasked with summarizing conversations."),
			expect.any(Array),
			undefined, // metadata is undefined when not passed to summarizeConversation
		)
		// Verify the CRITICAL instructions are included in the prompt
		const actualPrompt = (mockApiHandler.createMessage as Mock).mock.calls[0][0]
		expect(actualPrompt).toContain("CRITICAL: This is a summarization-only request")
		expect(actualPrompt).toContain("CRITICAL: This summarization request is a SYSTEM OPERATION")

		// Check that maybeRemoveImageBlocks was called with the correct messages
		// The final request message now contains the detailed CONDENSE instructions
		const mockCallArgs = (maybeRemoveImageBlocks as Mock).mock.calls[0][0] as any[]
		const finalMessage = mockCallArgs[mockCallArgs.length - 1]
		expect(finalMessage.role).toBe("user")
		expect(finalMessage.content).toContain("Your task is to create a detailed summary of the conversation")
	})

	it("should include the original first user message in summarization input", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial ask", ts: 1 },
			{ role: "assistant", content: "Ack", ts: 2 },
			{ role: "user", content: "Follow-up", ts: 3 },
			{ role: "assistant", content: "Response", ts: 4 },
			{ role: "user", content: "More", ts: 5 },
			{ role: "assistant", content: "Later", ts: 6 },
			{ role: "user", content: "Newest", ts: 7 },
		]

		await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		const mockCallArgs = (maybeRemoveImageBlocks as Mock).mock.calls[0][0] as any[]

		// Expect the original first user message to be present in the messages sent to the summarizer
		const hasInitialAsk = mockCallArgs.some(
			(m) =>
				m.role === "user" &&
				(typeof m.content === "string"
					? m.content === "Initial ask"
					: Array.isArray(m.content) &&
						m.content.some((b: any) => b.type === "text" && b.text === "Initial ask")),
		)
		expect(hasInitialAsk).toBe(true)
	})

	it("should calculate newContextTokens correctly with systemPrompt", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const systemPrompt = "You are a helpful assistant."

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "This is a summary with system prompt" }
			yield { type: "usage" as const, totalCost: 0.06, outputTokens: 200 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt,
			taskId,
		})

		// Verify that countTokens was called with system prompt + summary message
		expect(mockApiHandler.countTokens).toHaveBeenCalled()

		// newContextTokens = countTokens(systemPrompt + summaryMessage) - counts actual content
		expect(result.newContextTokens).toBe(100) // countTokens mock returns 100
		expect(result.cost).toBe(0.06)
		expect(result.summary).toBe("This is a summary with system prompt")
		expect(result.error).toBeUndefined()
	})

	it("should successfully summarize conversation", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create a stream that produces a summary with reasonable token count
		const streamWithSmallTokens = (async function* () {
			yield { type: "text" as const, text: "Concise summary" }
			yield { type: "usage" as const, totalCost: 0.03, outputTokens: 50 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithSmallTokens) as any

		// Mock countTokens to return a small value
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(30)) as any

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Result contains all messages plus summary
		expect(result.messages.length).toBe(messages.length + 1)

		// Fresh start: effective history should contain only the summary
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1)
		expect(effectiveHistory[0].isSummary).toBe(true)

		expect(result.cost).toBe(0.03)
		expect(result.summary).toBe("Concise summary")
		expect(result.error).toBeUndefined()
		// newContextTokens = countTokens(systemPrompt + summaryMessage) - counts actual content
		expect(result.newContextTokens).toBe(30) // countTokens mock returns 30
	})

	it("should return error when API handler is invalid", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create invalid handler (missing createMessage)
		const invalidHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.error to verify error message
		const originalError = console.error
		const mockError = vi.fn()
		console.error = mockError

		const result = await summarizeConversation({
			messages,
			apiHandler: invalidHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Should return original messages when handler is invalid
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()

		// Verify error was logged
		expect(mockError).toHaveBeenCalledWith(expect.stringContaining("API handler is invalid for condensing"))

		// Restore console.error
		console.error = originalError
	})

	it("should tag all messages with condenseParent (fresh start model)", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		const condenseId = summaryMessage!.condenseId

		// ALL original messages should be tagged (fresh start model tags everything)
		for (const msg of result.messages.filter((m) => !m.isSummary)) {
			expect(msg.condenseParent).toBe(condenseId)
		}
	})

	it("should place summary message at end of messages array", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = await summarizeConversation({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId,
		})

		// Summary should be the last message
		const lastMessage = result.messages[result.messages.length - 1]
		expect(lastMessage.isSummary).toBe(true)
		expect(lastMessage.role).toBe("user")
	})
})

describe("summarizeConversation with custom settings", () => {
	// Mock necessary dependencies
	let mockMainApiHandler: ApiHandler
	const defaultSystemPrompt = "Default prompt"
	const localTaskId = "test-task"

	// Sample messages for testing
	const sampleMessages: ApiMessage[] = [
		{ role: "user", content: "Hello", ts: 1 },
		{ role: "assistant", content: "Hi there", ts: 2 },
		{ role: "user", content: "How are you?", ts: 3 },
		{ role: "assistant", content: "I'm good", ts: 4 },
		{ role: "user", content: "What's new?", ts: 5 },
		{ role: "assistant", content: "Not much", ts: 6 },
		{ role: "user", content: "Tell me more", ts: 7 },
	]

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Reset telemetry mock
		;(TelemetryService.instance.captureContextCondensed as Mock).mockClear()

		// Setup mock API handler
		mockMainApiHandler = {
			createMessage: vi.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from main handler" }
					yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
				})()
			}),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(50)),
			getModel: vi.fn().mockReturnValue({
				id: "main-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler
	})

	/**
	 * Test that custom prompt is used when provided
	 */
	it("should use custom prompt when provided", async () => {
		const customPrompt = "Custom summarization prompt"

		await summarizeConversation({
			messages: sampleMessages,
			apiHandler: mockMainApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId: localTaskId,
			isAutomaticTrigger: false,
			customCondensingPrompt: customPrompt,
		})

		// Verify the custom prompt was used in the user message content
		const createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		// The custom prompt should be in the last message (the finalRequestMessage)
		const requestMessages = createMessageCalls[0][1]
		const lastMessage = requestMessages[requestMessages.length - 1]
		expect(lastMessage.role).toBe("user")
		expect(lastMessage.content).toBe(customPrompt)
	})

	/**
	 * Test that default system prompt is used when custom prompt is empty
	 */
	it("should use default systemPrompt when custom prompt is empty or not provided", async () => {
		// Test with empty string
		await summarizeConversation({
			messages: sampleMessages,
			apiHandler: mockMainApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId: localTaskId,
			isAutomaticTrigger: false,
			customCondensingPrompt: "  ",
		})

		// Verify the default SUMMARY_PROMPT was used (contains CRITICAL instructions)
		let createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain(
			"You are a helpful AI assistant tasked with summarizing conversations.",
		)
		expect(createMessageCalls[0][0]).toContain("CRITICAL: This is a summarization-only request")

		// Reset mock and test with undefined
		vi.clearAllMocks()
		await summarizeConversation({
			messages: sampleMessages,
			apiHandler: mockMainApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId: localTaskId,
			isAutomaticTrigger: false,
		})

		// Verify the default SUMMARY_PROMPT was used again (contains CRITICAL instructions)
		createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain(
			"You are a helpful AI assistant tasked with summarizing conversations.",
		)
		expect(createMessageCalls[0][0]).toContain("CRITICAL: This is a summarization-only request")
	})

	/**
	 * Test that telemetry is called for custom prompt usage
	 */
	it("should capture telemetry when using custom prompt", async () => {
		await summarizeConversation({
			messages: sampleMessages,
			apiHandler: mockMainApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId: localTaskId,
			isAutomaticTrigger: false,
			customCondensingPrompt: "Custom prompt",
		})

		// Verify telemetry was called with custom prompt flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			localTaskId,
			false,
			true, // usedCustomPrompt
		)
	})

	/**
	 * Test that telemetry is called with isAutomaticTrigger flag
	 */
	it("should capture telemetry with isAutomaticTrigger flag", async () => {
		await summarizeConversation({
			messages: sampleMessages,
			apiHandler: mockMainApiHandler,
			systemPrompt: defaultSystemPrompt,
			taskId: localTaskId,
			isAutomaticTrigger: true,
			customCondensingPrompt: "Custom prompt",
		})

		// Verify telemetry was called with isAutomaticTrigger flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			localTaskId,
			true, // isAutomaticTrigger
			true, // usedCustomPrompt
		)
	})
})

describe("toolUseToText", () => {
	it("should convert tool_use block with object input to text", () => {
		const block: Anthropic.Messages.ToolUseBlockParam = {
			type: "tool_use",
			id: "tool-123",
			name: "read_file",
			input: { path: "test.ts", encoding: "utf-8" },
		}

		const result = toolUseToText(block)

		expect(result).toBe("[Tool Use: read_file]\npath: test.ts\nencoding: utf-8")
	})

	it("should convert tool_use block with nested object input to text", () => {
		const block: Anthropic.Messages.ToolUseBlockParam = {
			type: "tool_use",
			id: "tool-456",
			name: "write_file",
			input: {
				path: "output.json",
				content: { key: "value", nested: { a: 1 } },
			},
		}

		const result = toolUseToText(block)

		expect(result).toContain("[Tool Use: write_file]")
		expect(result).toContain("path: output.json")
		expect(result).toContain("content:")
		expect(result).toContain('"key"')
		expect(result).toContain('"value"')
	})

	it("should convert tool_use block with string input to text", () => {
		const block: Anthropic.Messages.ToolUseBlockParam = {
			type: "tool_use",
			id: "tool-789",
			name: "execute_command",
			input: "ls -la" as unknown as Record<string, unknown>,
		}

		const result = toolUseToText(block)

		expect(result).toBe("[Tool Use: execute_command]\nls -la")
	})

	it("should handle empty object input", () => {
		const block: Anthropic.Messages.ToolUseBlockParam = {
			type: "tool_use",
			id: "tool-empty",
			name: "some_tool",
			input: {},
		}

		const result = toolUseToText(block)

		expect(result).toBe("[Tool Use: some_tool]\n")
	})
})

describe("toolResultToText", () => {
	it("should convert tool_result with string content to text", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "tool-123",
			content: "File contents here",
		}

		const result = toolResultToText(block)

		expect(result).toBe("[Tool Result]\nFile contents here")
	})

	it("should convert tool_result with error flag to text", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "tool-456",
			content: "File not found",
			is_error: true,
		}

		const result = toolResultToText(block)

		expect(result).toBe("[Tool Result (Error)]\nFile not found")
	})

	it("should convert tool_result with array content to text", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "tool-789",
			content: [
				{ type: "text", text: "First line" },
				{ type: "text", text: "Second line" },
			],
		}

		const result = toolResultToText(block)

		expect(result).toBe("[Tool Result]\nFirst line\nSecond line")
	})

	it("should handle tool_result with image in array content", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "tool-img",
			content: [
				{ type: "text", text: "Screenshot:" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
			],
		}

		const result = toolResultToText(block)

		expect(result).toBe("[Tool Result]\nScreenshot:\n[Image]")
	})

	it("should handle tool_result with no content", () => {
		const block: Anthropic.Messages.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "tool-empty",
		}

		const result = toolResultToText(block)

		expect(result).toBe("[Tool Result]")
	})
})

describe("convertToolBlocksToText", () => {
	it("should return string content unchanged", () => {
		const content = "Simple text content"

		const result = convertToolBlocksToText(content)

		expect(result).toBe("Simple text content")
	})

	it("should convert tool_use blocks to text blocks", () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{
				type: "tool_use",
				id: "tool-123",
				name: "read_file",
				input: { path: "test.ts" },
			},
		]

		const result = convertToolBlocksToText(content)

		expect(Array.isArray(result)).toBe(true)
		expect((result as Anthropic.Messages.ContentBlockParam[])[0].type).toBe("text")
		expect((result as Anthropic.Messages.TextBlockParam[])[0].text).toContain("[Tool Use: read_file]")
	})

	it("should convert tool_result blocks to text blocks", () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{
				type: "tool_result",
				tool_use_id: "tool-123",
				content: "File contents",
			},
		]

		const result = convertToolBlocksToText(content)

		expect(Array.isArray(result)).toBe(true)
		expect((result as Anthropic.Messages.ContentBlockParam[])[0].type).toBe("text")
		expect((result as Anthropic.Messages.TextBlockParam[])[0].text).toContain("[Tool Result]")
	})

	it("should preserve non-tool blocks unchanged", () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{ type: "text", text: "Hello" },
			{
				type: "tool_use",
				id: "tool-123",
				name: "read_file",
				input: { path: "test.ts" },
			},
			{ type: "text", text: "World" },
		]

		const result = convertToolBlocksToText(content)

		expect(Array.isArray(result)).toBe(true)
		const resultArray = result as Anthropic.Messages.ContentBlockParam[]
		expect(resultArray).toHaveLength(3)
		expect(resultArray[0]).toEqual({ type: "text", text: "Hello" })
		expect(resultArray[1].type).toBe("text")
		expect((resultArray[1] as Anthropic.Messages.TextBlockParam).text).toContain("[Tool Use: read_file]")
		expect(resultArray[2]).toEqual({ type: "text", text: "World" })
	})

	it("should handle mixed content with multiple tool blocks", () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{
				type: "tool_use",
				id: "tool-1",
				name: "read_file",
				input: { path: "a.ts" },
			},
			{
				type: "tool_result",
				tool_use_id: "tool-1",
				content: "contents of a.ts",
			},
		]

		const result = convertToolBlocksToText(content)

		expect(Array.isArray(result)).toBe(true)
		const resultArray = result as Anthropic.Messages.ContentBlockParam[]
		expect(resultArray).toHaveLength(2)
		expect((resultArray[0] as Anthropic.Messages.TextBlockParam).text).toContain("[Tool Use: read_file]")
		expect((resultArray[1] as Anthropic.Messages.TextBlockParam).text).toContain("[Tool Result]")
		expect((resultArray[1] as Anthropic.Messages.TextBlockParam).text).toContain("contents of a.ts")
	})
})

describe("transformMessagesForCondensing", () => {
	it("should transform all messages with tool blocks to text", () => {
		const messages = [
			{ role: "user" as const, content: "Hello" },
			{
				role: "assistant" as const,
				content: [
					{
						type: "tool_use" as const,
						id: "tool-1",
						name: "read_file",
						input: { path: "test.ts" },
					},
				],
			},
			{
				role: "user" as const,
				content: [
					{
						type: "tool_result" as const,
						tool_use_id: "tool-1",
						content: "file contents",
					},
				],
			},
		]

		const result = transformMessagesForCondensing(messages)

		expect(result).toHaveLength(3)
		expect(result[0].content).toBe("Hello")
		expect(Array.isArray(result[1].content)).toBe(true)
		expect((result[1].content as any[])[0].type).toBe("text")
		expect((result[1].content as any[])[0].text).toContain("[Tool Use: read_file]")
		expect(Array.isArray(result[2].content)).toBe(true)
		expect((result[2].content as any[])[0].type).toBe("text")
		expect((result[2].content as any[])[0].text).toContain("[Tool Result]")
	})

	it("should preserve message role and other properties", () => {
		const messages = [
			{
				role: "assistant" as const,
				content: [
					{
						type: "tool_use" as const,
						id: "tool-1",
						name: "execute",
						input: { cmd: "ls" },
					},
				],
			},
		]

		const result = transformMessagesForCondensing(messages)

		expect(result[0].role).toBe("assistant")
	})

	it("should handle empty messages array", () => {
		const result = transformMessagesForCondensing([])

		expect(result).toEqual([])
	})

	it("should not mutate original messages", () => {
		const originalContent = [
			{
				type: "tool_use" as const,
				id: "tool-1",
				name: "read_file",
				input: { path: "test.ts" },
			},
		]
		const messages = [{ role: "assistant" as const, content: originalContent }]

		transformMessagesForCondensing(messages)

		// Original should still have tool_use type
		expect(messages[0].content[0].type).toBe("tool_use")
	})
})
