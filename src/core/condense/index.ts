import Anthropic from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@roo-code/telemetry"

import { t } from "../../i18n"
import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"
import { findLast } from "../../shared/array"

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
 * Gets the tool_result blocks from a message.
 */
function getToolResultBlocks(message: ApiMessage): Anthropic.ToolResultBlockParam[] {
	if (message.role !== "user" || typeof message.content === "string") {
		return []
	}
	return message.content.filter((block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result")
}

/**
 * Finds a tool_use block by ID in a message.
 */
function findToolUseBlockById(message: ApiMessage, toolUseId: string): Anthropic.Messages.ToolUseBlock | undefined {
	if (message.role !== "assistant" || typeof message.content === "string") {
		return undefined
	}
	return message.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use" && block.id === toolUseId,
	)
}

/**
 * Gets reasoning blocks from a message's content array.
 * Task stores reasoning as {type: "reasoning", text: "..."} blocks,
 * which convertToR1Format and convertToZAiFormat already know how to extract.
 */
function getReasoningBlocks(message: ApiMessage): Anthropic.Messages.ContentBlockParam[] {
	if (message.role !== "assistant" || typeof message.content === "string") {
		return []
	}
	// Filter for reasoning blocks and cast to ContentBlockParam (the type field is compatible)
	return message.content.filter((block) => (block as any).type === "reasoning") as any[]
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
 * Checks ALL kept messages for tool_result blocks and searches backwards through the condensed
 * region (bounded by N_MESSAGES_TO_KEEP) to find the matching tool_use blocks by ID.
 * These tool_use blocks will be appended to the summary message to maintain proper pairing.
 *
 * Also extracts reasoning blocks from messages containing preserved tool_uses, which are required
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

	const toolUseBlocksToPreserve: Anthropic.Messages.ToolUseBlock[] = []
	const reasoningBlocksToPreserve: Anthropic.Messages.ContentBlockParam[] = []
	const preservedToolUseIds = new Set<string>()

	// Check ALL kept messages for tool_result blocks
	for (const keepMsg of keepMessages) {
		if (!hasToolResultBlocks(keepMsg)) {
			continue
		}

		const toolResults = getToolResultBlocks(keepMsg)

		for (const toolResult of toolResults) {
			const toolUseId = toolResult.tool_use_id

			// Skip if we've already found this tool_use
			if (preservedToolUseIds.has(toolUseId)) {
				continue
			}

			// Search backwards through the condensed region (bounded)
			const searchStart = startIndex - 1
			const searchEnd = Math.max(0, startIndex - N_MESSAGES_TO_KEEP)
			const messagesToSearch = messages.slice(searchEnd, searchStart + 1)

			// Find the message containing this tool_use
			const messageWithToolUse = findLast(messagesToSearch, (msg) => {
				return findToolUseBlockById(msg, toolUseId) !== undefined
			})

			if (messageWithToolUse) {
				const toolUse = findToolUseBlockById(messageWithToolUse, toolUseId)!
				toolUseBlocksToPreserve.push(toolUse)
				preservedToolUseIds.add(toolUseId)

				// Also preserve reasoning blocks from that message
				const reasoning = getReasoningBlocks(messageWithToolUse)
				reasoningBlocksToPreserve.push(...reasoning)
			}
		}
	}

	return {
		keepMessages,
		toolUseBlocksToPreserve,
		reasoningBlocksToPreserve,
	}
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

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			summary += chunk.text
		} else if (chunk.type === "usage") {
			// Record final usage chunk only
			cost = chunk.totalCost ?? 0
			outputTokens = chunk.outputTokens ?? 0
		}
	}

	summary = summary.trim()

	if (summary.length === 0) {
		const error = t("common:errors.condense_failed")
		return { ...response, cost, error }
	}

	// Build the summary message content
	// CRITICAL: Always include a reasoning block in the summary for DeepSeek-reasoner compatibility.
	// DeepSeek-reasoner requires `reasoning_content` on ALL assistant messages, not just those with tool_calls.
	// Without this, we get: "400 Missing `reasoning_content` field in the assistant message"
	// See: https://api-docs.deepseek.com/guides/thinking_mode
	//
	// The summary content structure is:
	// 1. Synthetic reasoning block (always present) - for DeepSeek-reasoner compatibility
	// 2. Any preserved reasoning blocks from the condensed assistant message (if tool_use blocks are preserved)
	// 3. Text block with the summary
	// 4. Tool_use blocks (if any need to be preserved for tool_result pairing)

	// Create a synthetic reasoning block that explains the summary
	// This is minimal but satisfies DeepSeek's requirement for reasoning_content on all assistant messages
	const syntheticReasoningBlock = {
		type: "reasoning" as const,
		text: "Condensing conversation context. The summary below captures the key information from the prior conversation.",
	}

	const textBlock: Anthropic.Messages.TextBlockParam = { type: "text", text: summary }

	let summaryContent: Anthropic.Messages.ContentBlockParam[]
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
