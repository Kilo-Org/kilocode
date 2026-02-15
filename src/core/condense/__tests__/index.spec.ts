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
	getKeepMessagesWithToolBlocks,
	getEffectiveApiHistory,
	cleanupAfterTruncation,
	N_MESSAGES_TO_KEEP,
	hasIncompatibleSummaryForExtendedThinking,
	uncondenseForExtendedThinking,
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
const DEFAULT_PREV_CONTEXT_TOKENS = 1000

describe("getKeepMessagesWithToolBlocks", () => {
	it("should return keepMessages without tool blocks when no tool_result blocks in first kept message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should return all messages when messages.length <= keepCount", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toEqual(messages)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve tool_use blocks when first kept message has tool_result blocks", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me read that file", ts: 2 },
			{ role: "user", content: "Please continue", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)
		expect(result.keepMessages[1].ts).toBe(6)
		expect(result.keepMessages[2].ts).toBe(7)

		// Should preserve the tool_use block from the preceding assistant message
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should not preserve tool_use blocks when first kept message is assistant role", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "Please read", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading..." }, toolUseBlock],
				ts: 4,
			},
			{ role: "user", content: "Continue", ts: 5 },
			{ role: "assistant", content: "Done", ts: 6 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// First kept message is assistant, not user with tool_result
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].role).toBe("assistant")
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should not preserve tool_use blocks when first kept user message has string content", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "Good", ts: 4 },
			{ role: "user", content: "Simple text message", ts: 5 }, // String content, not array
			{ role: "assistant", content: "Response", ts: 6 },
			{ role: "user", content: "More text", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should handle multiple tool_use blocks that need to be preserved", () => {
		const toolUseBlock1 = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "file1.txt" },
		}
		const toolUseBlock2 = {
			type: "tool_use" as const,
			id: "toolu_456",
			name: "read_file",
			input: { path: "file2.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "contents 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_456",
			content: "contents 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading files..." }, toolUseBlock1, toolUseBlock2],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock1, toolResultBlock2],
				ts: 3,
			},
			{ role: "assistant", content: "Got both files", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// Should preserve both tool_use blocks
		expect(result.toolUseBlocksToPreserve).toHaveLength(2)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock1)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock2)
	})

	it("should not preserve tool_use blocks when preceding message has no tool_use blocks", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Plain text response", ts: 2 }, // No tool_use blocks
			{
				role: "user",
				content: [toolResultBlock], // Has tool_result but preceding message has no tool_use
				ts: 3,
			},
			{ role: "assistant", content: "Response", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should handle edge case when startIndex - 1 is negative", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		// Only 3 messages total, so startIndex = 0 and precedingIndex would be -1
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [toolResultBlock],
				ts: 1,
			},
			{ role: "assistant", content: "Response", ts: 2 },
			{ role: "user", content: "Thanks", ts: 3 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toEqual(messages)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve reasoning blocks alongside tool_use blocks for DeepSeek/Z.ai interleaved thinking", () => {
		const reasoningBlock = {
			type: "reasoning" as const,
			text: "Let me think about this step by step...",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_deepseek_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_deepseek_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				// DeepSeek stores reasoning as content blocks alongside tool_use
				content: [reasoningBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)

		// Should preserve the tool_use block
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)

		// Should preserve the reasoning block for DeepSeek/Z.ai interleaved thinking
		expect(result.reasoningBlocksToPreserve).toHaveLength(1)
		expect((result.reasoningBlocksToPreserve[0] as any).type).toBe("reasoning")
		expect((result.reasoningBlocksToPreserve[0] as any).text).toBe("Let me think about this step by step...")
	})

	it("should return empty reasoningBlocksToPreserve when no reasoning blocks present", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				// No reasoning block, just text and tool_use
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock],
				ts: 3,
			},
			{ role: "assistant", content: "Done", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.reasoningBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve Anthropic thinking blocks alongside tool_use blocks", () => {
		const thinkingBlock = {
			type: "thinking" as const,
			thinking: "Let me analyze this...",
			signature: "sig_abc123",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_anthropic_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_anthropic_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				content: [thinkingBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)

		expect(result.reasoningBlocksToPreserve).toHaveLength(1)
		expect((result.reasoningBlocksToPreserve[0] as any).type).toBe("thinking")
		expect((result.reasoningBlocksToPreserve[0] as any).thinking).toBe("Let me analyze this...")
		expect((result.reasoningBlocksToPreserve[0] as any).signature).toBe("sig_abc123")
	})

	it("should preserve Anthropic redacted_thinking blocks alongside tool_use blocks", () => {
		const redactedThinkingBlock = {
			type: "redacted_thinking" as const,
			data: "encrypted_data_here",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_redacted_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_redacted_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				content: [
					redactedThinkingBlock as any,
					{ type: "text" as const, text: "Reading file..." },
					toolUseBlock,
				],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock],
				ts: 5,
			},
			{ role: "assistant", content: "Got it", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.reasoningBlocksToPreserve).toHaveLength(1)
		expect((result.reasoningBlocksToPreserve[0] as any).type).toBe("redacted_thinking")
		expect((result.reasoningBlocksToPreserve[0] as any).data).toBe("encrypted_data_here")
	})

	it("should preserve tool_use when tool_result is in 2nd kept message and tool_use is 2 messages before boundary", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_second_kept",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_second_kept",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 3,
			},
			{ role: "user", content: "Some other message", ts: 4 },
			{ role: "assistant", content: "First kept message", ts: 5 },
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 6,
			},
			{ role: "assistant", content: "Third kept message", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)
		expect(result.keepMessages[1].ts).toBe(6)
		expect(result.keepMessages[2].ts).toBe(7)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should preserve tool_use when tool_result is in 3rd kept message and tool_use is at boundary edge", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_third_kept",
			name: "search",
			input: { query: "test" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_third_kept",
			content: "search results",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Searching..." }, toolUseBlock],
				ts: 2,
			},
			{ role: "user", content: "First kept message", ts: 3 },
			{ role: "assistant", content: "Second kept message", ts: 4 },
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Done" }],
				ts: 5,
			},
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(3)
		expect(result.keepMessages[1].ts).toBe(4)
		expect(result.keepMessages[2].ts).toBe(5)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should preserve multiple tool_uses when tool_results are in different kept messages", () => {
		const toolUseBlock1 = {
			type: "tool_use" as const,
			id: "toolu_multi_1",
			name: "read_file",
			input: { path: "file1.txt" },
		}
		const toolUseBlock2 = {
			type: "tool_use" as const,
			id: "toolu_multi_2",
			name: "read_file",
			input: { path: "file2.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_multi_1",
			content: "contents 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_multi_2",
			content: "contents 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file 1..." }, toolUseBlock1],
				ts: 2,
			},
			{ role: "user", content: "Some message", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file 2..." }, toolUseBlock2],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock1, { type: "text" as const, text: "First result" }],
				ts: 5,
			},
			{
				role: "user",
				content: [toolResultBlock2, { type: "text" as const, text: "Second result" }],
				ts: 6,
			},
			{ role: "assistant", content: "Got both files", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)

		expect(result.toolUseBlocksToPreserve).toHaveLength(2)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock1)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock2)
	})

	it("should not crash when tool_result references tool_use beyond search boundary", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_beyond_boundary",
			content: "result",
		}

		const messages: ApiMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text" as const, text: "Way back..." },
					{
						type: "tool_use" as const,
						id: "toolu_beyond_boundary",
						name: "old_tool",
						input: {},
					},
				],
				ts: 1,
			},
			{ role: "user", content: "Message 2", ts: 2 },
			{ role: "assistant", content: "Message 3", ts: 3 },
			{ role: "user", content: "Message 4", ts: 4 },
			{ role: "assistant", content: "Message 5", ts: 5 },
			{ role: "user", content: "Message 6", ts: 6 },
			{ role: "assistant", content: "Message 7", ts: 7 },
			{
				role: "user",
				content: [toolResultBlock],
				ts: 8,
			},
			{ role: "assistant", content: "Message 9", ts: 9 },
			{ role: "user", content: "Message 10", ts: 10 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(8)
		expect(result.keepMessages[1].ts).toBe(9)
		expect(result.keepMessages[2].ts).toBe(10)

		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should not duplicate tool_use blocks when same tool_result ID appears multiple times", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_duplicate",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_duplicate",
			content: "result 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_duplicate",
			content: "result 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Using tool..." }, toolUseBlock],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock1],
				ts: 3,
			},
			{ role: "assistant", content: "Processing", ts: 4 },
			{
				role: "user",
				content: [toolResultBlock2],
				ts: 5,
			},
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
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

	it("should return messages since the last summary with original first user message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		])
	})

	it("should handle multiple summary messages and return since the last one with original first user message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "First summary", ts: 2, isSummary: true },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		])
	})

	it("should handle empty messages array", () => {
		const result = getMessagesSinceLastSummary([])
		expect(result).toEqual([])
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
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy() // Error should be set for not enough messages
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should not summarize when there was a recent summary", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6, isSummary: true }, // Recent summary
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy() // Error should be set for recent summary
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should summarize conversation and insert summary message", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Check that the API was called correctly
		expect(mockApiHandler.createMessage).toHaveBeenCalled()
		expect(maybeRemoveImageBlocks).toHaveBeenCalled()

		// With non-destructive condensing, the result contains ALL original messages
		// plus the summary message. Condensed messages are tagged but not deleted.
		// Use getEffectiveApiHistory to verify the effective API view matches the old behavior.
		expect(result.messages.length).toBe(messages.length + 1) // All original messages + summary

		// Check that the first message is preserved
		expect(result.messages[0]).toEqual(messages[0])

		// Find the summary message (it has isSummary: true)
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		// Summary content is now always an array with [synthetic reasoning, text]
		// for DeepSeek-reasoner compatibility (requires reasoning_content on all assistant messages)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(2)
		expect(content[0].type).toBe("reasoning")
		expect(content[1].type).toBe("text")
		expect(content[1].text).toBe("This is a summary")
		expect(summaryMessage!.isSummary).toBe(true)

		// Verify that the effective API history matches expected: first + summary + last N messages
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // First + summary + last N

		// Check that condensed messages are properly tagged
		const condensedMessages = result.messages.filter((m) => m.condenseParent !== undefined)
		expect(condensedMessages.length).toBeGreaterThan(0)

		// Check the cost and token counts
		expect(result.cost).toBe(0.05)
		expect(result.summary).toBe("This is a summary")
		expect(result.newContextTokens).toBe(250) // 150 output tokens + 100 from countTokens
		expect(result.error).toBeUndefined()
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

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

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

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

		// Verify the final request message
		const expectedFinalMessage = {
			role: "user",
			content: "Summarize the conversation so far, as described in the prompt instructions.",
		}

		// Verify that createMessage was called with the correct prompt
		expect(mockApiHandler.createMessage).toHaveBeenCalledWith(
			expect.stringContaining("Your task is to create a detailed summary of the conversation"),
			expect.any(Array),
		)

		// Check that maybeRemoveImageBlocks was called with the correct messages
		const mockCallArgs = (maybeRemoveImageBlocks as Mock).mock.calls[0][0] as any[]
		expect(mockCallArgs[mockCallArgs.length - 1]).toEqual(expectedFinalMessage)
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

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

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

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			systemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Verify that countTokens was called with the correct messages including system prompt
		expect(mockApiHandler.countTokens).toHaveBeenCalled()

		// Check the newContextTokens calculation includes system prompt
		expect(result.newContextTokens).toBe(300) // 200 output tokens + 100 from countTokens
		expect(result.cost).toBe(0.06)
		expect(result.summary).toBe("This is a summary with system prompt")
		expect(result.error).toBeUndefined()
	})

	it("should return error when new context tokens >= previous context tokens", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create a stream that produces a summary
		const streamWithLargeTokens = (async function* () {
			yield { type: "text" as const, text: "This is a very long summary that uses many tokens" }
			yield { type: "usage" as const, totalCost: 0.08, outputTokens: 500 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithLargeTokens) as any

		// Mock countTokens to return a high value that when added to outputTokens (500)
		// will be >= prevContextTokens (600)
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(200)) as any

		const prevContextTokens = 600
		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			prevContextTokens,
		)

		// Should return original messages when context would grow
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0.08)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
	})

	it("should successfully summarize when new context tokens < previous context tokens", async () => {
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

		// Mock countTokens to return a small value so total is < prevContextTokens
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(30)) as any

		const prevContextTokens = 200
		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			prevContextTokens,
		)

		// With non-destructive condensing, result contains all messages plus summary
		// Use getEffectiveApiHistory to verify the effective API view
		expect(result.messages.length).toBe(messages.length + 1) // All messages + summary
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // First + summary + last N
		expect(result.cost).toBe(0.03)
		expect(result.summary).toBe("Concise summary")
		expect(result.error).toBeUndefined()
		expect(result.newContextTokens).toBe(80) // 50 output tokens + 30 from countTokens
		expect(result.newContextTokens).toBeLessThan(prevContextTokens)
	})

	it("should return error when not enough messages to summarize", async () => {
		const messages: ApiMessage[] = [{ role: "user", content: "Hello", ts: 1 }]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Should return original messages when not enough to summarize
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should return error when recent summary exists in kept messages", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Recent summary", ts: 6, isSummary: true }, // Summary in last 3 messages
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Should return original messages when recent summary exists
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should return error when both condensing and main API handlers are invalid", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create invalid handlers (missing createMessage)
		const invalidMainHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		const invalidCondensingHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.error to verify error message
		const originalError = console.error
		const mockError = vi.fn()
		console.error = mockError

		const result = await summarizeConversation(
			messages,
			invalidMainHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			invalidCondensingHandler,
		)

		// Should return original messages when both handlers are invalid
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()

		// Verify error was logged
		expect(mockError).toHaveBeenCalledWith(
			expect.stringContaining("Main API handler is also invalid for condensing"),
		)

		// Restore console.error
		console.error = originalError
	})

	it("should append tool_use blocks to summary message when first kept message has tool_result blocks", async () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me read that file", ts: 2 },
			{ role: "user", content: "Please continue", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			true, // useNativeTools - required for tool_use block preservation
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)

		// Content should be [synthetic reasoning, text block, tool_use block]
		// The synthetic reasoning is always added for DeepSeek-reasoner compatibility
		const content = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		expect(content).toHaveLength(3)
		expect((content[0] as any).type).toBe("reasoning") // Synthetic reasoning for DeepSeek
		expect(content[1].type).toBe("text")
		expect((content[1] as Anthropic.Messages.TextBlockParam).text).toBe("Summary of conversation")
		expect(content[2].type).toBe("tool_use")
		expect((content[2] as Anthropic.Messages.ToolUseBlockParam).id).toBe("toolu_123")
		expect((content[2] as Anthropic.Messages.ToolUseBlockParam).name).toBe("read_file")

		// With non-destructive condensing, all messages are retained plus the summary
		expect(result.messages.length).toBe(messages.length + 1) // all original + summary
		// Verify effective history matches expected
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // first + summary + last 3
		expect(result.error).toBeUndefined()
	})

	it("should include user tool_result message in summarize request when preserving tool_use blocks", async () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_history_fix",
			name: "read_file",
			input: { path: "sample.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_history_fix",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Running tool..." }, toolUseBlock],
				ts: 3,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Thanks" }],
				ts: 4,
			},
			{ role: "assistant", content: "Anything else?", ts: 5 },
			{ role: "user", content: "Nope", ts: 6 },
		]

		let capturedRequestMessages: any[] | undefined
		const customStream = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockImplementation((_prompt, requestMessagesParam) => {
			capturedRequestMessages = requestMessagesParam
			return customStream
		}) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true,
		)

		expect(result.error).toBeUndefined()
		expect(capturedRequestMessages).toBeDefined()

		const requestMessages = capturedRequestMessages!
		expect(requestMessages[requestMessages.length - 1]).toEqual({
			role: "user",
			content: "Summarize the conversation so far, as described in the prompt instructions.",
		})

		const historyMessages = requestMessages.slice(0, -1)
		expect(historyMessages.length).toBeGreaterThanOrEqual(2)

		const assistantMessage = historyMessages[historyMessages.length - 2]
		const userMessage = historyMessages[historyMessages.length - 1]

		expect(assistantMessage.role).toBe("assistant")
		expect(Array.isArray(assistantMessage.content)).toBe(true)
		expect(
			(assistantMessage.content as any[]).some(
				(block) => block.type === "tool_use" && block.id === toolUseBlock.id,
			),
		).toBe(true)

		expect(userMessage.role).toBe("user")
		expect(Array.isArray(userMessage.content)).toBe(true)
		expect(
			(userMessage.content as any[]).some(
				(block) => block.type === "tool_result" && block.tool_use_id === toolUseBlock.id,
			),
		).toBe(true)
	})

	it("should append multiple tool_use blocks for parallel tool calls", async () => {
		const toolUseBlockA = {
			type: "tool_use" as const,
			id: "toolu_parallel_1",
			name: "search",
			input: { query: "foo" },
		}
		const toolUseBlockB = {
			type: "tool_use" as const,
			id: "toolu_parallel_2",
			name: "search",
			input: { query: "bar" },
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{ role: "assistant", content: "Working...", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Launching parallel tools" }, toolUseBlockA, toolUseBlockB],
				ts: 3,
			},
			{
				role: "user",
				content: [
					{ type: "tool_result" as const, tool_use_id: "toolu_parallel_1", content: "result A" },
					{ type: "tool_result" as const, tool_use_id: "toolu_parallel_2", content: "result B" },
					{ type: "text" as const, text: "Continue" },
				],
				ts: 4,
			},
			{ role: "assistant", content: "Processing results", ts: 5 },
			{ role: "user", content: "Thanks", ts: 6 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true,
		)

		// Find the summary message (it has isSummary: true)
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const summaryContent = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		// First block is synthetic reasoning for DeepSeek-reasoner compatibility
		expect((summaryContent[0] as any).type).toBe("reasoning")
		// Second block is the text summary
		expect(summaryContent[1]).toEqual({ type: "text", text: "This is a summary" })

		const preservedToolUses = summaryContent.filter(
			(block): block is Anthropic.Messages.ToolUseBlockParam => block.type === "tool_use",
		)
		expect(preservedToolUses).toHaveLength(2)
		expect(preservedToolUses.map((block) => block.id)).toEqual(["toolu_parallel_1", "toolu_parallel_2"])
	})

	it("should preserve reasoning blocks in summary message for DeepSeek/Z.ai interleaved thinking", async () => {
		const reasoningBlock = {
			type: "reasoning" as const,
			text: "Let me think about this step by step...",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_deepseek_reason",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_deepseek_reason",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				// DeepSeek stores reasoning as content blocks alongside tool_use
				content: [reasoningBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			true, // useNativeTools - required for tool_use block preservation
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)

		// Content should be [synthetic reasoning, preserved reasoning, text block, tool_use block]
		// - Synthetic reasoning is always added for DeepSeek-reasoner compatibility
		// - Preserved reasoning from the condensed assistant message
		// This order ensures reasoning_content is always present for DeepSeek/Z.ai
		const content = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		expect(content).toHaveLength(4)

		// First block should be synthetic reasoning
		expect((content[0] as any).type).toBe("reasoning")
		expect((content[0] as any).text).toContain("Condensing conversation context")

		// Second block should be preserved reasoning from the condensed message
		expect((content[1] as any).type).toBe("reasoning")
		expect((content[1] as any).text).toBe("Let me think about this step by step...")

		// Third block should be text (the summary)
		expect(content[2].type).toBe("text")
		expect((content[2] as Anthropic.Messages.TextBlockParam).text).toBe("Summary of conversation")

		// Fourth block should be tool_use
		expect(content[3].type).toBe("tool_use")
		expect((content[3] as Anthropic.Messages.ToolUseBlockParam).id).toBe("toolu_deepseek_reason")

		expect(result.error).toBeUndefined()
	})

	it("should include synthetic reasoning block in summary for DeepSeek-reasoner compatibility even without tool_use blocks", async () => {
		// This test verifies the fix for the DeepSeek-reasoner 400 error:
		// "Missing `reasoning_content` field in the assistant message at message index 1"
		// DeepSeek-reasoner requires reasoning_content on ALL assistant messages, not just those with tool_calls.
		// After condensation, the summary becomes an assistant message that needs reasoning_content.
		const messages: ApiMessage[] = [
			{ role: "user", content: "Tell me a joke", ts: 1 },
			{ role: "assistant", content: "Why did the programmer quit?", ts: 2 },
			{ role: "user", content: "I don't know, why?", ts: 3 },
			{ role: "assistant", content: "He didn't get arrays!", ts: 4 },
			{ role: "user", content: "Another one please", ts: 5 },
			{ role: "assistant", content: "Why do programmers prefer dark mode?", ts: 6 },
			{ role: "user", content: "Why?", ts: 7 },
		]

		// Create a stream with usage information (no tool calls in this conversation)
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary: User requested jokes." }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			false, // useNativeTools - not using tools in this test
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)

		// CRITICAL: Content must be an array with a synthetic reasoning block
		// This is required for DeepSeek-reasoner which needs reasoning_content on all assistant messages
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const content = summaryMessage!.content as any[]

		// Should have [synthetic reasoning, text]
		expect(content).toHaveLength(2)
		expect(content[0].type).toBe("reasoning")
		expect(content[0].text).toContain("Condensing conversation context")
		expect(content[1].type).toBe("text")
		expect(content[1].text).toBe("Summary: User requested jokes.")

		expect(result.error).toBeUndefined()
	})

	it("should place Anthropic thinking blocks first in summary and skip synthetic reasoning", async () => {
		// This test verifies the fix for Anthropic extended thinking 400 error:
		// "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`"
		// When Anthropic extended thinking is enabled, assistant messages must start with thinking blocks.
		// Synthetic reasoning blocks (type: "reasoning") get filtered by filterNonAnthropicBlocks,
		// leaving the message starting with text, which causes the 400 error.
		const thinkingBlock = {
			type: "thinking" as const,
			thinking: "Let me analyze this request...",
			signature: "sig123456789",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_anthropic_think",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_anthropic_think",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				// Anthropic extended thinking stores thinking blocks with signature
				content: [thinkingBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			true, // useNativeTools - required for tool_use block preservation
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)

		// Content should be [thinking block, text block, tool_use block]
		// - Thinking block FIRST (required by Anthropic when extended thinking enabled)
		// - NO synthetic reasoning block (would be filtered by filterNonAnthropicBlocks anyway)
		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(3)

		// First block should be the preserved thinking block (NOT synthetic reasoning)
		expect(content[0].type).toBe("thinking")
		expect(content[0].thinking).toBe("Let me analyze this request...")
		expect(content[0].signature).toBe("sig123456789")

		// Second block should be text (the summary)
		expect(content[1].type).toBe("text")
		expect(content[1].text).toBe("Summary of conversation")

		// Third block should be tool_use
		expect(content[2].type).toBe("tool_use")
		expect(content[2].id).toBe("toolu_anthropic_think")

		expect(result.error).toBeUndefined()
	})

	it("should place Anthropic redacted_thinking blocks first in summary", async () => {
		// Test that redacted_thinking blocks are also handled correctly
		const redactedThinkingBlock = {
			type: "redacted_thinking" as const,
			data: "encrypted_data_here",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_redacted",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_redacted",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				content: [
					redactedThinkingBlock as any,
					{ type: "text" as const, text: "Reading file..." },
					toolUseBlock,
				],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true,
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(3)

		// First block should be redacted_thinking (NOT synthetic reasoning)
		expect(content[0].type).toBe("redacted_thinking")
		expect(content[0].data).toBe("encrypted_data_here")

		expect(result.error).toBeUndefined()
	})

	it("should capture thinking blocks from condensing API response stream", async () => {
		// Test that when the condensing API returns thinking blocks in the stream,
		// they are captured and placed first in the summary message.
		// This is the key fix for the Anthropic 400 error after condensation.
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please do something", ts: 3 },
			{ role: "assistant", content: "Working on it", ts: 4 },
			{ role: "user", content: "Continue", ts: 5 },
			{ role: "assistant", content: "Done", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Simulate condensing API response with thinking blocks
		const streamWithThinking = (async function* () {
			// Condensing API returns thinking block first
			yield {
				type: "ant_thinking" as const,
				thinking: "Analyzing the conversation to create a summary...",
				signature: "stream_sig_12345",
			}
			yield { type: "text" as const, text: "Summary of the conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithThinking) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			false, // useNativeTools
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")

		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(2)

		// First block should be the thinking block captured from stream (NOT synthetic reasoning)
		expect(content[0].type).toBe("thinking")
		expect(content[0].thinking).toBe("Analyzing the conversation to create a summary...")
		expect(content[0].signature).toBe("stream_sig_12345")

		// Second block should be the summary text
		expect(content[1].type).toBe("text")
		expect(content[1].text).toBe("Summary of the conversation")

		expect(result.error).toBeUndefined()
	})

	it("should capture redacted_thinking blocks from condensing API response stream", async () => {
		// Test that redacted_thinking blocks from stream are also captured
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please do something", ts: 3 },
			{ role: "assistant", content: "Working on it", ts: 4 },
			{ role: "user", content: "Continue", ts: 5 },
			{ role: "assistant", content: "Done", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Simulate condensing API response with redacted_thinking block
		const streamWithRedactedThinking = (async function* () {
			yield {
				type: "ant_redacted_thinking" as const,
				data: "encrypted_thinking_data_from_stream",
			}
			yield { type: "text" as const, text: "Summary of the conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithRedactedThinking) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			false,
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()

		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(2)

		// First block should be redacted_thinking from stream
		expect(content[0].type).toBe("redacted_thinking")
		expect(content[0].data).toBe("encrypted_thinking_data_from_stream")

		// Second block should be the summary text
		expect(content[1].type).toBe("text")

		expect(result.error).toBeUndefined()
	})

	it("should prioritize thinking blocks from stream over preserved blocks from history", async () => {
		// When both stream thinking blocks and preserved thinking blocks exist,
		// the stream blocks should take priority (they have valid signatures for the new summary)
		const preservedThinkingBlock = {
			type: "thinking" as const,
			thinking: "Old thinking from history...",
			signature: "old_sig_from_history",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_priority_test",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_priority_test",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				content: [
					preservedThinkingBlock as any,
					{ type: "text" as const, text: "Reading file..." },
					toolUseBlock,
				],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Simulate condensing API returning NEW thinking blocks
		const streamWithNewThinking = (async function* () {
			yield {
				type: "ant_thinking" as const,
				thinking: "NEW thinking from condensing API response...",
				signature: "new_stream_sig_priority",
			}
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithNewThinking) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true, // useNativeTools - to trigger tool_use preservation logic
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()

		const content = summaryMessage!.content as any[]

		// First block should be the NEW thinking from stream (NOT the old one from history)
		expect(content[0].type).toBe("thinking")
		expect(content[0].thinking).toBe("NEW thinking from condensing API response...")
		expect(content[0].signature).toBe("new_stream_sig_priority")

		// Should NOT contain the old thinking block from history
		const hasOldThinking = content.some(
			(block: any) => block.type === "thinking" && block.signature === "old_sig_from_history",
		)
		expect(hasOldThinking).toBe(false)

		expect(result.error).toBeUndefined()
	})

	it("should use last ant_thinking chunk when multiple are emitted during streaming", async () => {
		// During streaming, multiple ant_thinking chunks may be emitted:
		// 1. From content_block_start (partial data)
		// 2. From signature_delta (complete data)
		// The code should use the last one with complete data
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please do something", ts: 3 },
			{ role: "assistant", content: "Working on it", ts: 4 },
			{ role: "user", content: "Continue", ts: 5 },
			{ role: "assistant", content: "Done", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Simulate streaming with multiple ant_thinking chunks
		const streamWithMultipleThinking = (async function* () {
			// First chunk - partial data (as if from content_block_start)
			yield {
				type: "ant_thinking" as const,
				thinking: "Initial partial thinking...",
				signature: "partial_sig",
			}
			// Final chunk - complete data (as if from signature_delta)
			yield {
				type: "ant_thinking" as const,
				thinking: "Complete accumulated thinking from the full response...",
				signature: "final_complete_sig",
			}
			yield { type: "text" as const, text: "Summary of the conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithMultipleThinking) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			false,
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()

		const content = summaryMessage!.content as any[]
		expect(content).toHaveLength(2)

		// Should use the LAST ant_thinking chunk with complete data
		expect(content[0].type).toBe("thinking")
		expect(content[0].thinking).toBe("Complete accumulated thinking from the full response...")
		expect(content[0].signature).toBe("final_complete_sig")

		expect(result.error).toBeUndefined()
	})
})

describe("summarizeConversation with custom settings", () => {
	// Mock necessary dependencies
	let mockMainApiHandler: ApiHandler
	let mockCondensingApiHandler: ApiHandler
	const defaultSystemPrompt = "Default prompt"
	const taskId = "test-task"

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

		// Setup mock API handlers
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

		mockCondensingApiHandler = {
			createMessage: vi.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from condensing handler" }
					yield { type: "usage" as const, totalCost: 0.03, outputTokens: 80 }
				})()
			}),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(40)),
			getModel: vi.fn().mockReturnValue({
				id: "condensing-model",
				info: {
					contextWindow: 4000,
					supportsImages: true,
					supportsVision: false,
					maxTokens: 2000,
					supportsPromptCache: false,
					maxCachePoints: 0,
					minTokensPerCachePoint: 0,
					cachableFields: [],
				},
			}),
		} as unknown as ApiHandler
	})

	/**
	 * Test that custom prompt is used when provided
	 */
	it("should use custom prompt when provided", async () => {
		const customPrompt = "Custom summarization prompt"

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			customPrompt,
		)

		// Verify the custom prompt was used
		const createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toBe(customPrompt)
	})

	/**
	 * Test that default system prompt is used when custom prompt is empty
	 */
	it("should use default systemPrompt when custom prompt is empty or not provided", async () => {
		// Test with empty string
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			"  ", // Empty custom prompt
		)

		// Verify the default prompt was used
		let createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("Your task is to create a detailed summary")

		// Reset mock and test with undefined
		vi.clearAllMocks()
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined, // No custom prompt
		)

		// Verify the default prompt was used again
		createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("Your task is to create a detailed summary")
	})

	/**
	 * Test that condensing API handler is used when provided and valid
	 */
	it("should use condensingApiHandler when provided and valid", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify the condensing handler was used
		expect((mockCondensingApiHandler.createMessage as Mock).mock.calls.length).toBe(1)
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(0)
	})

	/**
	 * Test fallback to main API handler when condensing handler is not provided
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is not provided", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
		)

		// Verify the main handler was used
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(1)
	})

	/**
	 * Test fallback to main API handler when condensing handler is invalid
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is invalid", async () => {
		// Create an invalid handler (missing createMessage)
		const invalidHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.warn to verify warning message
		const originalWarn = console.warn
		const mockWarn = vi.fn()
		console.warn = mockWarn

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			invalidHandler,
		)

		// Verify the main handler was used as fallback
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(1)

		// Verify warning was logged
		expect(mockWarn).toHaveBeenCalledWith(
			expect.stringContaining("Chosen API handler for condensing does not support message creation"),
		)

		// Restore console.warn
		console.warn = originalWarn
	})

	/**
	 * Test that telemetry is called for custom prompt usage
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using custom prompt", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			"Custom prompt",
		)

		// Verify telemetry was called with custom prompt flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			true, // usedCustomPrompt
			false, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called for custom API handler usage
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using custom API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with custom API handler flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			false, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called with both custom prompt and API handler
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using both custom prompt and API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			true, // isAutomaticTrigger
			"Custom prompt",
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with both flags
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			true, // isAutomaticTrigger
			true, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})
})

// kilocode_change start
describe("hasIncompatibleSummaryForExtendedThinking", () => {
	const extendedThinkingModel = { supportsReasoningBudget: true } as any
	const regularModel = { supportsReasoningBudget: false } as any

	it("should return false for models without extended thinking", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary" }],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
		]

		expect(hasIncompatibleSummaryForExtendedThinking(messages, regularModel)).toBe(false)
	})

	it("should return true when summary lacks thinking blocks for extended thinking model", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary" }],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
		]

		expect(hasIncompatibleSummaryForExtendedThinking(messages, extendedThinkingModel)).toBe(true)
	})

	it("should return false when summary has thinking blocks", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Thinking...", signature: "sig123" },
					{ type: "text", text: "Summary" },
				],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
		]

		expect(hasIncompatibleSummaryForExtendedThinking(messages, extendedThinkingModel)).toBe(false)
	})

	it("should return false when summary has redacted_thinking blocks", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "redacted_thinking", data: "encrypted" },
					{ type: "text", text: "Summary" },
				],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
		]

		expect(hasIncompatibleSummaryForExtendedThinking(messages, extendedThinkingModel)).toBe(false)
	})

	it("should return false when there are no summaries", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		expect(hasIncompatibleSummaryForExtendedThinking(messages, extendedThinkingModel)).toBe(false)
	})
})

describe("uncondenseForExtendedThinking", () => {
	const extendedThinkingModel = { supportsReasoningBudget: true } as any
	const regularModel = { supportsReasoningBudget: false } as any

	it("should not modify messages for models without extended thinking", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary" }],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
		]

		const result = uncondenseForExtendedThinking(messages, regularModel)

		expect(result.didUncondense).toBe(false)
		expect(result.messages).toEqual(messages)
	})

	it("should remove invalid summary and restore condensed messages", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hidden by condense", ts: 2, condenseParent: "test-id" },
			{ role: "user", content: "Another hidden", ts: 3, condenseParent: "test-id" },
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary" }],
				ts: 4,
				isSummary: true,
				condenseId: "test-id",
			},
			{ role: "user", content: "Recent message", ts: 5 },
		]

		const result = uncondenseForExtendedThinking(messages, extendedThinkingModel)

		expect(result.didUncondense).toBe(true)
		expect(result.messages).toHaveLength(4) // Summary removed
		expect(result.messages.some((m) => m.isSummary)).toBe(false)
		// Condensed messages should have condenseParent cleared
		expect(result.messages[1].condenseParent).toBeUndefined()
		expect(result.messages[2].condenseParent).toBeUndefined()
	})

	it("should keep valid summaries with thinking blocks", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Thinking...", signature: "sig123" },
					{ type: "text", text: "Summary" },
				],
				ts: 2,
				isSummary: true,
				condenseId: "test-id",
			},
			{ role: "user", content: "Recent message", ts: 3 },
		]

		const result = uncondenseForExtendedThinking(messages, extendedThinkingModel)

		expect(result.didUncondense).toBe(false)
		expect(result.messages).toEqual(messages)
	})

	it("should handle multiple summaries - only remove invalid ones", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			// First condense - valid
			{ role: "assistant", content: "Hidden 1", ts: 2, condenseParent: "valid-id" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "...", signature: "sig" },
					{ type: "text", text: "Valid Summary" },
				],
				ts: 3,
				isSummary: true,
				condenseId: "valid-id",
			},
			// Second condense - invalid
			{ role: "assistant", content: "Hidden 2", ts: 4, condenseParent: "invalid-id" },
			{
				role: "assistant",
				content: [{ type: "text", text: "Invalid Summary" }],
				ts: 5,
				isSummary: true,
				condenseId: "invalid-id",
			},
			{ role: "user", content: "Recent", ts: 6 },
		]

		const result = uncondenseForExtendedThinking(messages, extendedThinkingModel)

		expect(result.didUncondense).toBe(true)
		// Valid summary should remain, invalid should be removed
		const summaries = result.messages.filter((m) => m.isSummary)
		expect(summaries).toHaveLength(1)
		expect(summaries[0].condenseId).toBe("valid-id")
		// Hidden 2 should have condenseParent cleared, Hidden 1 should keep it
		const hidden1 = result.messages.find((m) => m.content === "Hidden 1")
		const hidden2 = result.messages.find((m) => m.content === "Hidden 2")
		expect(hidden1?.condenseParent).toBe("valid-id")
		expect(hidden2?.condenseParent).toBeUndefined()
	})
})
// kilocode_change end
