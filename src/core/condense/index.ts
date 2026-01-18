import Anthropic from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@roo-code/telemetry"
import { ModelInfo } from "@roo-code/types"

import { t } from "../../i18n"
import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"

/**
 * Checks if a message contains tool_result blocks.
 * For native tools protocol, user messages with tool_result blocks require
 * corresponding tool_use blocks from the previous assistant turn.
 */
function hasToolResultBlocks(message: ApiMessage): boolean {
	if (message.role !== "user" || typeof message.content === "string") {
		return false
	}
	return message.content.some((block) => block.type === "tool_result")
}

/**
 * Gets the tool_use blocks from a message.
 */
function getToolUseBlocks(message: ApiMessage): Anthropic.Messages.ToolUseBlock[] {
	if (message.role !== "assistant" || typeof message.content === "string") {
		return []
	}
	return message.content.filter((block) => block.type === "tool_use") as Anthropic.Messages.ToolUseBlock[]
}

/**
 * Gets reasoning blocks from a message's content array.
 * Task stores reasoning as:
 * - {type: "reasoning", text: "..."} blocks for DeepSeek/Z.ai (convertToR1Format/convertToZAiFormat extract these)
 * - {type: "thinking", thinking: "...", signature: "..."} blocks for Anthropic extended thinking
 * - {type: "redacted_thinking", data: "..."} blocks for Anthropic redacted thinking
 */
function getReasoningBlocks(message: ApiMessage): Anthropic.Messages.ContentBlockParam[] {
	if (message.role !== "assistant" || typeof message.content === "string") {
		return []
	}
	// Filter for reasoning blocks (DeepSeek/Z.ai) and thinking blocks (Anthropic extended thinking)
	// These are different formats but serve the same purpose
	return message.content.filter((block) => {
		const blockType = (block as any).type
		return blockType === "reasoning" || blockType === "thinking" || blockType === "redacted_thinking"
	}) as any[]
}

/**
 * Result of getKeepMessagesWithToolBlocks
 */
export type KeepMessagesResult = {
	keepMessages: ApiMessage[]
	toolUseBlocksToPreserve: Anthropic.Messages.ToolUseBlock[]
	// Reasoning blocks from the preceding assistant message, needed for DeepSeek/Z.ai
	// when tool_use blocks are preserved. Task stores reasoning as {type: "reasoning", text: "..."}
	// blocks, and convertToR1Format/convertToZAiFormat already extract these.
	reasoningBlocksToPreserve: Anthropic.Messages.ContentBlockParam[]
}

/**
 * Extracts tool_use blocks that need to be preserved to match tool_result blocks in keepMessages.
 * When the first kept message is a user message with tool_result blocks,
 * we need to find the corresponding tool_use blocks from the preceding assistant message.
 * These tool_use blocks will be appended to the summary message to maintain proper pairing.
 *
 * Also extracts reasoning blocks from the preceding assistant message, which are required
 * by DeepSeek and Z.ai for interleaved thinking mode. Without these, the API returns a 400 error
 * "Missing reasoning_content field in the assistant message".
 * See: https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
 *
 * @param messages - The full conversation messages
 * @param keepCount - The number of messages to keep from the end
 * @returns Object containing keepMessages, tool_use blocks, and reasoning blocks to preserve
 */
export function getKeepMessagesWithToolBlocks(messages: ApiMessage[], keepCount: number): KeepMessagesResult {
	if (messages.length <= keepCount) {
		return { keepMessages: messages, toolUseBlocksToPreserve: [], reasoningBlocksToPreserve: [] }
	}

	const startIndex = messages.length - keepCount
	const keepMessages = messages.slice(startIndex)

	// Check if the first kept message is a user message with tool_result blocks
	if (keepMessages.length > 0 && hasToolResultBlocks(keepMessages[0])) {
		// Look for the preceding assistant message with tool_use blocks
		const precedingIndex = startIndex - 1
		if (precedingIndex >= 0) {
			const precedingMessage = messages[precedingIndex]
			const toolUseBlocks = getToolUseBlocks(precedingMessage)
			if (toolUseBlocks.length > 0) {
				// Also extract reasoning blocks for DeepSeek/Z.ai interleaved thinking
				// Task stores reasoning as {type: "reasoning", text: "..."} content blocks
				const reasoningBlocks = getReasoningBlocks(precedingMessage)
				// Return the tool_use blocks and reasoning blocks to be merged into the summary message
				return {
					keepMessages,
					toolUseBlocksToPreserve: toolUseBlocks,
					reasoningBlocksToPreserve: reasoningBlocks,
				}
			}
		}
	}

	return { keepMessages, toolUseBlocksToPreserve: [], reasoningBlocksToPreserve: [] }
}

export const N_MESSAGES_TO_KEEP = 3
export const MIN_CONDENSE_THRESHOLD = 5 // Minimum percentage of context window to trigger condensing
export const MAX_CONDENSE_THRESHOLD = 100 // Maximum percentage of context window to trigger condensing

const SUMMARY_PROMPT = `\
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.

Your summary should be structured as follows:
Context: The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to summarize the conversation. Pay special attention to the more recent messages in the conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Example summary structure:
1. Previous Conversation:
  [Detailed description]
2. Current Work:
  [Detailed description]
3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]
4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]
5. Problem Solving:
  [Detailed description]
6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]

Output only the summary of the conversation so far, without any additional commentary or explanation.
`

export type SummarizeResponse = {
	messages: ApiMessage[] // The messages after summarization
	summary: string // The summary text; empty string for no summary
	cost: number // The cost of the summarization operation
	newContextTokens?: number // The number of tokens in the context for the next API request
	error?: string // Populated iff the operation fails: error message shown to the user on failure (see Task.ts)
	condenseId?: string // The unique ID of the created Summary message, for linking to condense_context clineMessage
}

/**
 * Summarizes the conversation messages using an LLM call
 *
 * @param {ApiMessage[]} messages - The conversation messages
 * @param {ApiHandler} apiHandler - The API handler to use for token counting.
 * @param {string} systemPrompt - The system prompt for API requests, which should be considered in the context token count
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @param {boolean} isAutomaticTrigger - Whether the summarization is triggered automatically
 * @returns {SummarizeResponse} - The result of the summarization operation (see above)
 */
/**
 * Summarizes the conversation messages using an LLM call
 *
 * @param {ApiMessage[]} messages - The conversation messages
 * @param {ApiHandler} apiHandler - The API handler to use for token counting (fallback if condensingApiHandler not provided)
 * @param {string} systemPrompt - The system prompt for API requests (fallback if customCondensingPrompt not provided)
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @param {number} prevContextTokens - The number of tokens currently in the context, used to ensure we don't grow the context
 * @param {boolean} isAutomaticTrigger - Whether the summarization is triggered automatically
 * @param {string} customCondensingPrompt - Optional custom prompt to use for condensing
 * @param {ApiHandler} condensingApiHandler - Optional specific API handler to use for condensing
 * @param {boolean} useNativeTools - Whether native tools protocol is being used (requires tool_use/tool_result pairing)
 * @returns {SummarizeResponse} - The result of the summarization operation (see above)
 */
export async function summarizeConversation(
	messages: ApiMessage[],
	apiHandler: ApiHandler,
	systemPrompt: string,
	taskId: string,
	prevContextTokens: number,
	isAutomaticTrigger?: boolean,
	customCondensingPrompt?: string,
	condensingApiHandler?: ApiHandler,
	useNativeTools?: boolean,
): Promise<SummarizeResponse> {
	TelemetryService.instance.captureContextCondensed(
		taskId,
		isAutomaticTrigger ?? false,
		!!customCondensingPrompt?.trim(),
		!!condensingApiHandler,
	)

	const response: SummarizeResponse = { messages, cost: 0, summary: "" }

	// Always preserve the first message (which may contain slash command content)
	const firstMessage = messages[0]

	// Get keepMessages and any tool_use/reasoning blocks that need to be preserved for tool_result pairing
	// Only preserve these blocks when using native tools protocol (XML protocol doesn't need them)
	const { keepMessages, toolUseBlocksToPreserve, reasoningBlocksToPreserve } = useNativeTools
		? getKeepMessagesWithToolBlocks(messages, N_MESSAGES_TO_KEEP)
		: {
				keepMessages: messages.slice(-N_MESSAGES_TO_KEEP),
				toolUseBlocksToPreserve: [],
				reasoningBlocksToPreserve: [],
			}

	const keepStartIndex = Math.max(messages.length - N_MESSAGES_TO_KEEP, 0)
	const includeFirstKeptMessageInSummary = toolUseBlocksToPreserve.length > 0
	const summarySliceEnd = includeFirstKeptMessageInSummary ? keepStartIndex + 1 : keepStartIndex
	const messagesBeforeKeep = summarySliceEnd > 0 ? messages.slice(0, summarySliceEnd) : []

	// Get messages to summarize, including the first message and excluding the last N messages
	let messagesToSummarize = getMessagesSinceLastSummary(messagesBeforeKeep) // kilocode_change: const=>let

	// kilocode_change start
	// discard tool_use, because it won't have a result
	const lastMessageToSummarizeContent = messagesToSummarize.at(-1)?.content
	if (
		Array.isArray(lastMessageToSummarizeContent) &&
		lastMessageToSummarizeContent.some((item) => item.type === "tool_use")
	) {
		console.debug("[summarizeConversation] discarding tool_use", lastMessageToSummarizeContent)
		messagesToSummarize = messagesToSummarize.slice(0, -1)
	}
	// kilocode_change end

	if (messagesToSummarize.length <= 1) {
		// kilocode_change start
		const error =
			messages.length <= N_MESSAGES_TO_KEEP + 1
				? t("common:errors.condense_not_enough_messages", {
						prevContextTokens,
						messageCount: messages.length,
						minimumMessageCount: N_MESSAGES_TO_KEEP + 2,
					})
				: t("common:errors.condensed_recently")
		// kilocode_change end
		return { ...response, error }
	}

	// Check if there's a recent summary in the messages we're keeping
	const recentSummaryExists = keepMessages.some((message: ApiMessage) => message.isSummary)

	if (recentSummaryExists) {
		const error = t("common:errors.condensed_recently")
		return { ...response, error }
	}

	const finalRequestMessage: Anthropic.MessageParam = {
		role: "user",
		content: "Summarize the conversation so far, as described in the prompt instructions.",
	}

	const requestMessages = maybeRemoveImageBlocks([...messagesToSummarize, finalRequestMessage], apiHandler).map(
		({ role, content }) => ({ role, content }),
	)

	// Note: this doesn't need to be a stream, consider using something like apiHandler.completePrompt
	// Use custom prompt if provided and non-empty, otherwise use the default SUMMARY_PROMPT
	const promptToUse = customCondensingPrompt?.trim() ? customCondensingPrompt.trim() : SUMMARY_PROMPT

	// Use condensing API handler if provided, otherwise use main API handler
	let handlerToUse = condensingApiHandler || apiHandler

	// Check if the chosen handler supports the required functionality
	if (!handlerToUse || typeof handlerToUse.createMessage !== "function") {
		console.warn(
			"Chosen API handler for condensing does not support message creation or is invalid, falling back to main apiHandler.",
		)

		handlerToUse = apiHandler // Fallback to the main, presumably valid, apiHandler

		// Ensure the main apiHandler itself is valid before this point or add another check.
		if (!handlerToUse || typeof handlerToUse.createMessage !== "function") {
			// This case should ideally not happen if main apiHandler is always valid.
			// Consider throwing an error or returning a specific error response.
			console.error("Main API handler is also invalid for condensing. Cannot proceed.")
			// Return an appropriate error structure for SummarizeResponse
			const error = t("common:errors.condense_handler_invalid")
			return { ...response, error }
		}
	}

	const stream = handlerToUse.createMessage(promptToUse, requestMessages)

	let summary = ""
	let cost = 0
	let outputTokens = 0

	// kilocode_change start: Capture thinking blocks from condensing response
	// When condensing with Anthropic extended thinking enabled, the response will include
	// thinking/redacted_thinking blocks with valid signatures. We need to capture these
	// and include them in the summary message so the next API request is valid.
	// The API requires assistant messages to start with thinking blocks when extended thinking is enabled.
	const summaryThinkingBlocks: Anthropic.Messages.ContentBlockParam[] = []
	// Track the last ant_thinking chunk (multiple may be emitted during streaming, we want the final one)
	let lastAntThinking: { thinking: string; signature: string } | null = null
	// kilocode_change end

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			summary += chunk.text
		} else if (chunk.type === "usage") {
			// Record final usage chunk only
			cost = chunk.totalCost ?? 0
			outputTokens = chunk.outputTokens ?? 0
		}
		// kilocode_change start: Capture Anthropic thinking blocks from condensing response
		else if (chunk.type === "ant_thinking") {
			// Multiple ant_thinking chunks may be emitted during streaming:
			// 1. From content_block_start (may have partial data)
			// 2. From signature_delta (has full accumulated thinking + signature)
			// Keep the last one with a valid signature as it has the complete data
			if (chunk.thinking && chunk.signature) {
				lastAntThinking = { thinking: chunk.thinking, signature: chunk.signature }
			}
		} else if (chunk.type === "ant_redacted_thinking") {
			// Redacted thinking blocks should be preserved as-is
			summaryThinkingBlocks.push({
				type: "redacted_thinking",
				data: chunk.data,
			} as Anthropic.Messages.RedactedThinkingBlock)
		}
		// kilocode_change end
	}

	// kilocode_change start: Finalize captured thinking blocks
	// Add the final ant_thinking chunk as a proper thinking block
	if (lastAntThinking) {
		summaryThinkingBlocks.push({
			type: "thinking",
			thinking: lastAntThinking.thinking,
			signature: lastAntThinking.signature,
		} as Anthropic.Messages.ThinkingBlock)
	}
	// kilocode_change end

	summary = summary.trim()

	if (summary.length === 0) {
		const error = t("common:errors.condense_failed")
		return { ...response, cost, error }
	}

	// Build the summary message content
	// Provider-specific handling:
	//
	// 1. Anthropic extended thinking: When using Anthropic extended thinking, assistant messages
	//    must start with thinking blocks (type: "thinking" or "redacted_thinking").
	//    Thinking blocks come from TWO sources:
	//    a) summaryThinkingBlocks: Captured from the condensing API response (has valid signatures)
	//    b) reasoningBlocksToPreserve: Preserved from preceding message (for tool_result pairing)
	//    The summaryThinkingBlocks take priority as they are from the actual condensing response.
	//    The synthetic reasoning block (type: "reasoning") gets filtered out by filterNonAnthropicBlocks
	//    anyway, and would cause a 400 error if it's the only block before the text content.
	//
	// 2. DeepSeek-reasoner: Requires `reasoning_content` on ALL assistant messages.
	//    Without the synthetic reasoning block, we get: "400 Missing `reasoning_content` field"
	//    See: https://api-docs.deepseek.com/guides/thinking_mode
	//
	// The summary content structure depends on what blocks are available:
	// - If Anthropic thinking blocks from stream: [stream thinking blocks..., text, tool_use blocks...]
	// - If Anthropic thinking blocks preserved: [preserved thinking blocks..., text, tool_use blocks...]
	// - Otherwise (DeepSeek/Z.ai): [synthetic reasoning, preserved reasoning..., text, tool_use blocks...]

	const textBlock: Anthropic.Messages.TextBlockParam = { type: "text", text: summary }

	// kilocode_change start: Check for thinking blocks from BOTH sources
	// Priority: thinking blocks captured from condensing response > preserved from history
	const hasSummaryThinkingBlocks = summaryThinkingBlocks.length > 0
	const hasPreservedAnthropicThinkingBlocks = reasoningBlocksToPreserve.some((block) => {
		const blockType = (block as any).type
		return blockType === "thinking" || blockType === "redacted_thinking"
	})
	const hasAnthropicThinkingBlocks = hasSummaryThinkingBlocks || hasPreservedAnthropicThinkingBlocks

	// Check if the main API handler uses Anthropic extended thinking (supportsReasoningBudget)
	// If so, and we don't have valid thinking blocks for the summary, condensation is incompatible
	// because Anthropic requires the final assistant message to start with a thinking block
	// when extended thinking is enabled, and we can't generate valid signed thinking blocks.
	const mainModelInfo = apiHandler.getModel().info
	const mainModelHasExtendedThinking = mainModelInfo.supportsReasoningBudget === true

	if (mainModelHasExtendedThinking && !hasAnthropicThinkingBlocks) {
		// The main model has extended thinking enabled, but we couldn't capture valid thinking blocks
		// from the condensing response. This will cause a 400 error when sending the next request.
		// Return an error instead of creating an invalid summary.
		const error =
			"Cannot condense context: Anthropic extended thinking requires thinking blocks in assistant messages, but the condensing model did not produce valid thinking blocks. Use the same model for condensing or disable extended thinking."
		return { ...response, cost, error }
	}
	// kilocode_change end

	let summaryContent: Anthropic.Messages.ContentBlockParam[]
	if (hasAnthropicThinkingBlocks) {
		// Anthropic extended thinking: Place thinking blocks first, skip synthetic reasoning
		// The thinking blocks have valid signatures and will pass API validation
		// kilocode_change start: Use thinking blocks from stream if available, otherwise use preserved
		const thinkingBlocksToUse = hasSummaryThinkingBlocks ? summaryThinkingBlocks : reasoningBlocksToPreserve
		// kilocode_change end
		if (toolUseBlocksToPreserve.length > 0) {
			summaryContent = [...thinkingBlocksToUse, textBlock, ...toolUseBlocksToPreserve]
		} else {
			summaryContent = [...thinkingBlocksToUse, textBlock]
		}
	} else {
		// DeepSeek/Z.ai or no thinking blocks: Include synthetic reasoning for compatibility
		const syntheticReasoningBlock = {
			type: "reasoning" as const,
			text: "Condensing conversation context. The summary below captures the key information from the prior conversation.",
		}

		if (toolUseBlocksToPreserve.length > 0) {
			// Include: synthetic reasoning, preserved reasoning (if any), summary text, and tool_use blocks
			summaryContent = [
				syntheticReasoningBlock as unknown as Anthropic.Messages.ContentBlockParam,
				...reasoningBlocksToPreserve,
				textBlock,
				...toolUseBlocksToPreserve,
			]
		} else {
			// Include: synthetic reasoning and summary text
			// This ensures the summary always has reasoning_content for DeepSeek-reasoner
			summaryContent = [syntheticReasoningBlock as unknown as Anthropic.Messages.ContentBlockParam, textBlock]
		}
	}

	// Generate a unique condenseId for this summary
	const condenseId = crypto.randomUUID()

	// Use first kept message's timestamp minus 1 to ensure unique timestamp for summary.
	// Fallback to Date.now() if keepMessages is empty (shouldn't happen due to earlier checks).
	const firstKeptTs = keepMessages[0]?.ts ?? Date.now()

	const summaryMessage: ApiMessage = {
		role: "assistant",
		content: summaryContent,
		ts: firstKeptTs - 1, // Unique timestamp before first kept message to avoid collision
		isSummary: true,
		condenseId, // Unique ID for this summary, used to track which messages it replaces
	}

	// NON-DESTRUCTIVE CONDENSE:
	// Instead of deleting middle messages, tag them with condenseParent so they can be
	// restored if the user rewinds to a point before the summary.
	//
	// Storage structure after condense:
	// [firstMessage, msg2(parent=X), ..., msg8(parent=X), summary(id=X), msg9, msg10, msg11]
	//
	// Effective for API (filtered by getEffectiveApiHistory):
	// [firstMessage, summary, msg9, msg10, msg11]

	// Tag middle messages with condenseParent (skip first message, skip last N messages)
	const newMessages = messages.map((msg, index) => {
		// First message stays as-is
		if (index === 0) {
			return msg
		}
		// Messages in the "keep" range stay as-is
		if (index >= keepStartIndex) {
			return msg
		}
		// Middle messages get tagged with condenseParent (unless they already have one from a previous condense)
		// If they already have a condenseParent, we leave it - nested condense is handled by filtering
		if (!msg.condenseParent) {
			return { ...msg, condenseParent: condenseId }
		}
		return msg
	})

	// Insert the summary message right before the keep messages
	newMessages.splice(keepStartIndex, 0, summaryMessage)

	// Count the tokens in the context for the next API request
	// We only estimate the tokens in summaryMesage if outputTokens is 0, otherwise we use outputTokens
	const systemPromptMessage: ApiMessage = { role: "user", content: systemPrompt }

	const contextMessages = outputTokens
		? [systemPromptMessage, ...keepMessages]
		: [systemPromptMessage, summaryMessage, ...keepMessages]

	const contextBlocks = contextMessages.flatMap((message) =>
		typeof message.content === "string" ? [{ text: message.content, type: "text" as const }] : message.content,
	)

	const newContextTokens = outputTokens + (await apiHandler.countTokens(contextBlocks))
	if (newContextTokens >= prevContextTokens) {
		// kilocode_change add numbers
		const error = t("common:errors.condense_context_grew", { prevContextTokens, newContextTokens })
		return { ...response, cost, error }
	}
	return { messages: newMessages, summary, cost, newContextTokens, condenseId }
}

/* Returns the list of all messages since the last summary message, including the summary. Returns all messages if there is no summary. */
export function getMessagesSinceLastSummary(messages: ApiMessage[]): ApiMessage[] {
	let lastSummaryIndexReverse = [...messages].reverse().findIndex((message) => message.isSummary)

	if (lastSummaryIndexReverse === -1) {
		return messages
	}

	const lastSummaryIndex = messages.length - lastSummaryIndexReverse - 1
	const messagesSinceSummary = messages.slice(lastSummaryIndex)

	// Bedrock requires the first message to be a user message.
	// We preserve the original first message to maintain context.
	// See https://github.com/RooCodeInc/Roo-Code/issues/4147
	if (messagesSinceSummary.length > 0 && messagesSinceSummary[0].role !== "user") {
		// Get the original first message (should always be a user message with the task)
		const originalFirstMessage = messages[0]
		if (originalFirstMessage && originalFirstMessage.role === "user") {
			// Use the original first message unchanged to maintain full context
			return [originalFirstMessage, ...messagesSinceSummary]
		} else {
			// Fallback to generic message if no original first message exists (shouldn't happen)
			const userMessage: ApiMessage = {
				role: "user",
				content: "Please continue from the following summary:",
				ts: messages[0]?.ts ? messages[0].ts - 1 : Date.now(),
			}
			return [userMessage, ...messagesSinceSummary]
		}
	}

	return messagesSinceSummary
}

/**
 * Filters the API conversation history to get the "effective" messages to send to the API.
 * Messages with a condenseParent that points to an existing summary are filtered out,
 * as they have been replaced by that summary.
 * Messages with a truncationParent that points to an existing truncation marker are also filtered out,
 * as they have been hidden by sliding window truncation.
 *
 * This allows non-destructive condensing and truncation where messages are tagged but not deleted,
 * enabling accurate rewind operations while still sending condensed/truncated history to the API.
 *
 * @param messages - The full API conversation history including tagged messages
 * @returns The filtered history that should be sent to the API
 */
export function getEffectiveApiHistory(messages: ApiMessage[]): ApiMessage[] {
	// Collect all condenseIds of summaries that exist in the current history
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that exist in the current history
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Filter out messages whose condenseParent points to an existing summary
	// or whose truncationParent points to an existing truncation marker.
	// Messages with orphaned parents (summary/marker was deleted) are included
	return messages.filter((msg) => {
		// Filter out condensed messages if their summary exists
		if (msg.condenseParent && existingSummaryIds.has(msg.condenseParent)) {
			return false
		}
		// Filter out truncated messages if their truncation marker exists
		if (msg.truncationParent && existingTruncationIds.has(msg.truncationParent)) {
			return false
		}
		return true
	})
}

/**
 * Cleans up orphaned condenseParent and truncationParent references after a truncation operation (rewind/delete).
 * When a summary message or truncation marker is deleted, messages that were tagged with its ID
 * should have their parent reference cleared so they become active again.
 *
 * This function should be called after any operation that truncates the API history
 * to ensure messages are properly restored when their summary or truncation marker is deleted.
 *
 * @param messages - The API conversation history after truncation
 * @returns The cleaned history with orphaned condenseParent and truncationParent fields cleared
 */
export function cleanupAfterTruncation(messages: ApiMessage[]): ApiMessage[] {
	// Collect all condenseIds of summaries that still exist
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that still exist
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Clear orphaned parent references for messages whose summary or truncation marker was deleted
	return messages.map((msg) => {
		let needsUpdate = false

		// Check for orphaned condenseParent
		if (msg.condenseParent && !existingSummaryIds.has(msg.condenseParent)) {
			needsUpdate = true
		}

		// Check for orphaned truncationParent
		if (msg.truncationParent && !existingTruncationIds.has(msg.truncationParent)) {
			needsUpdate = true
		}

		if (needsUpdate) {
			// Create a new object without orphaned parent references
			const { condenseParent, truncationParent, ...rest } = msg
			const result: ApiMessage = rest as ApiMessage

			// Keep condenseParent if its summary still exists
			if (condenseParent && existingSummaryIds.has(condenseParent)) {
				result.condenseParent = condenseParent
			}

			// Keep truncationParent if its truncation marker still exists
			if (truncationParent && existingTruncationIds.has(truncationParent)) {
				result.truncationParent = truncationParent
			}

			return result
		}
		return msg
	})
}

/**
 * Checks if a summary message has valid Anthropic thinking blocks.
 * Returns true if the summary starts with thinking or redacted_thinking block.
 */
function summaryHasValidThinkingBlocks(message: ApiMessage): boolean {
	if (!message.isSummary || typeof message.content === "string") {
		return false
	}
	if (message.content.length === 0) {
		return false
	}
	const firstBlock = message.content[0] as { type: string }
	return firstBlock.type === "thinking" || firstBlock.type === "redacted_thinking"
}

/**
 * Checks if any summary message in the history is incompatible with Anthropic extended thinking.
 * When extended thinking is enabled, all assistant messages (including summaries) must start
 * with thinking or redacted_thinking blocks. If a summary was created without these blocks
 * (e.g., by a different model or before this requirement was known), it will cause a 400 error.
 *
 * @param messages - The API conversation history
 * @param modelInfo - The model info to check for extended thinking support
 * @returns true if there are incompatible summaries that need to be removed
 */
export function hasIncompatibleSummaryForExtendedThinking(messages: ApiMessage[], modelInfo: ModelInfo): boolean {
	// Only relevant for models with extended thinking (supportsReasoningBudget)
	if (!modelInfo.supportsReasoningBudget) {
		return false
	}

	// Check if any summary message lacks valid thinking blocks
	for (const msg of messages) {
		if (msg.isSummary && !summaryHasValidThinkingBlocks(msg)) {
			return true
		}
	}

	return false
}

/**
 * Removes invalid summary messages and restores condensed messages for extended thinking compatibility.
 * This is used when a conversation was condensed with a model that doesn't support extended thinking,
 * but is now being used with a model that requires thinking blocks in all assistant messages.
 *
 * The function:
 * 1. Identifies summaries without valid thinking blocks
 * 2. Removes those summary messages
 * 3. Clears condenseParent references for messages that were condensed by those summaries
 *
 * @param messages - The API conversation history
 * @param modelInfo - The model info to check for extended thinking support
 * @returns Object containing the cleaned messages and whether any uncondensing occurred
 */
export function uncondenseForExtendedThinking(
	messages: ApiMessage[],
	modelInfo: ModelInfo,
): { messages: ApiMessage[]; didUncondense: boolean } {
	// Only relevant for models with extended thinking
	if (!modelInfo.supportsReasoningBudget) {
		return { messages, didUncondense: false }
	}

	// Collect condenseIds of invalid summaries (summaries without thinking blocks)
	const invalidSummaryIds = new Set<string>()
	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId && !summaryHasValidThinkingBlocks(msg)) {
			invalidSummaryIds.add(msg.condenseId)
		}
	}

	if (invalidSummaryIds.size === 0) {
		return { messages, didUncondense: false }
	}

	// Remove invalid summaries and clear condenseParent for messages that were condensed by them
	const cleanedMessages = messages
		.filter((msg) => {
			// Remove invalid summary messages
			if (msg.isSummary && msg.condenseId && invalidSummaryIds.has(msg.condenseId)) {
				return false
			}
			return true
		})
		.map((msg) => {
			// Clear condenseParent for messages that referenced invalid summaries
			if (msg.condenseParent && invalidSummaryIds.has(msg.condenseParent)) {
				const { condenseParent, ...rest } = msg
				return rest as ApiMessage
			}
			return msg
		})

	return { messages: cleanedMessages, didUncondense: true }
}
