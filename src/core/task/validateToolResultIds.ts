import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"
import { findLastIndex } from "../../shared/array"

/**
 * Custom error class for tool result ID mismatches.
 * Used for structured error tracking via PostHog.
 */
export class ToolResultIdMismatchError extends Error {
	constructor(
		message: string,
		public readonly toolResultIds: string[],
		public readonly toolUseIds: string[],
	) {
		super(message)
		this.name = "ToolResultIdMismatchError"
	}
}

/**
 * Custom error class for missing tool results.
 * Used for structured error tracking via PostHog when tool_use blocks
 * don't have corresponding tool_result blocks.
 */
export class MissingToolResultError extends Error {
	constructor(
		message: string,
		public readonly missingToolUseIds: string[],
		public readonly existingToolResultIds: string[],
	) {
		super(message)
		this.name = "MissingToolResultError"
	}
}

/**
 * Validates and fixes tool_result IDs in a user message against the previous assistant message.
 *
 * This is a centralized validation that catches all tool_use/tool_result issues
 * before messages are added to the API conversation history. It handles scenarios like:
 * - Race conditions during streaming
 * - Message editing scenarios
 * - Resume/delegation scenarios
 * - Missing tool_result blocks for tool_use calls
 *
 * @param userMessage - The user message being added to history
 * @param apiConversationHistory - The conversation history to find the previous assistant message from
 * @returns The validated user message with corrected tool_use_ids and any missing tool_results added
 */
export function validateAndFixToolResultIds(
	userMessage: Anthropic.MessageParam,
	apiConversationHistory: Anthropic.MessageParam[],
): Anthropic.MessageParam {
	// Only process user messages with array content
	if (userMessage.role !== "user" || !Array.isArray(userMessage.content)) {
		return userMessage
	}

	// Find the previous assistant message from conversation history
	const prevAssistantIdx = findLastIndex(apiConversationHistory, (msg) => msg.role === "assistant")
	if (prevAssistantIdx === -1) {
		return userMessage
	}

	const previousAssistantMessage = apiConversationHistory[prevAssistantIdx]

	// Get tool_use blocks from the assistant message
	const assistantContent = previousAssistantMessage.content
	if (!Array.isArray(assistantContent)) {
		return userMessage
	}

	const toolUseBlocks = assistantContent.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")

	// No tool_use blocks to match against - no validation needed
	if (toolUseBlocks.length === 0) {
		return userMessage
	}

	// Find tool_result blocks in the user message
	const toolResults = userMessage.content.filter(
		(block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result",
	)

	// Build a set of valid tool_use IDs
	const validToolUseIds = new Set(toolUseBlocks.map((block) => block.id))

	// Build a set of existing tool_result IDs
	const existingToolResultIds = new Set(toolResults.map((r) => r.tool_use_id))

	// Check for missing tool_results (tool_use IDs that don't have corresponding tool_results)
	const missingToolUseIds = toolUseBlocks
		.filter((toolUse) => !existingToolResultIds.has(toolUse.id))
		.map((toolUse) => toolUse.id)

	// Check if any tool_result has an invalid ID
	const hasInvalidIds = toolResults.some((result) => !validToolUseIds.has(result.tool_use_id))

	// If no missing tool_results and no invalid IDs, no changes needed
	if (missingToolUseIds.length === 0 && !hasInvalidIds) {
		return userMessage
	}

	// We have issues - need to fix them
	const toolResultIdList = toolResults.map((r) => r.tool_use_id)
	const toolUseIdList = toolUseBlocks.map((b) => b.id)

	// Report missing tool_results to PostHog error tracking
	if (missingToolUseIds.length > 0 && TelemetryService.hasInstance()) {
		TelemetryService.instance.captureException(
			new MissingToolResultError(
				`Detected missing tool_result blocks. Missing tool_use IDs: [${missingToolUseIds.join(", ")}], existing tool_result IDs: [${toolResultIdList.join(", ")}]`,
				missingToolUseIds,
				toolResultIdList,
			),
			{
				missingToolUseIds,
				existingToolResultIds: toolResultIdList,
				toolUseCount: toolUseBlocks.length,
				toolResultCount: toolResults.length,
			},
		)
	}

	// Report ID mismatches to PostHog error tracking
	if (hasInvalidIds && TelemetryService.hasInstance()) {
		TelemetryService.instance.captureException(
			new ToolResultIdMismatchError(
				`Detected tool_result ID mismatch. tool_result IDs: [${toolResultIdList.join(", ")}], tool_use IDs: [${toolUseIdList.join(", ")}]`,
				toolResultIdList,
				toolUseIdList,
			),
			{
				toolResultIds: toolResultIdList,
				toolUseIds: toolUseIdList,
				toolResultCount: toolResults.length,
				toolUseCount: toolUseBlocks.length,
			},
		)
	}

	// Create a mapping of tool_result IDs to corrected IDs
	// Strategy: Match by position (first tool_result -> first tool_use, etc.)
	// This handles most cases where the mismatch is due to ID confusion
	//
	// Track which tool_use IDs have been used to prevent duplicates
	const usedToolUseIds = new Set<string>()

	const correctedContent = userMessage.content
		.map((block) => {
			if (block.type !== "tool_result") {
				return block
			}

			// If the ID is already valid and not yet used, keep it
			if (validToolUseIds.has(block.tool_use_id) && !usedToolUseIds.has(block.tool_use_id)) {
				usedToolUseIds.add(block.tool_use_id)
				return block
			}

			// Find which tool_result index this block is by comparing references.
			// This correctly handles duplicate tool_use_ids - we find the actual block's
			// position among all tool_results, not the first block with a matching ID.
			const toolResultIndex = toolResults.indexOf(block as Anthropic.ToolResultBlockParam)

			// Try to match by position - only fix if there's a corresponding tool_use
			if (toolResultIndex !== -1 && toolResultIndex < toolUseBlocks.length) {
				const correctId = toolUseBlocks[toolResultIndex].id
				// Only use this ID if it hasn't been used yet
				if (!usedToolUseIds.has(correctId)) {
					usedToolUseIds.add(correctId)
					return {
						...block,
						tool_use_id: correctId,
					}
				}
			}

			// No corresponding tool_use for this tool_result, or the ID is already used
			// Filter out this orphaned tool_result by returning null
			return null
		})
		.filter((block): block is NonNullable<typeof block> => block !== null)

	// Add missing tool_result blocks for any tool_use that doesn't have one
	// After the ID correction above, recalculate which tool_use IDs are now covered
	const coveredToolUseIds = new Set(
		correctedContent
			.filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result")
			.map((r) => r.tool_use_id),
	)

	const stillMissingToolUseIds = toolUseBlocks.filter((toolUse) => !coveredToolUseIds.has(toolUse.id))

	// Build final content: add missing tool_results at the beginning if any
	const missingToolResults: Anthropic.ToolResultBlockParam[] = stillMissingToolUseIds.map((toolUse) => ({
		type: "tool_result" as const,
		tool_use_id: toolUse.id,
		content: "Tool execution was interrupted before completion.",
	}))

	// Insert missing tool_results at the beginning of the content array
	// This ensures they come before any text blocks that may summarize the results
	const finalContent = missingToolResults.length > 0 ? [...missingToolResults, ...correctedContent] : correctedContent

	return {
		...userMessage,
		content: finalContent,
	}
}
