// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"

/**
 * Custom error class for duplicate tool_use IDs.
 * Used for structured error tracking via PostHog when the same tool_use ID
 * appears multiple times in an assistant message.
 */
export class DuplicateToolUseError extends Error {
	constructor(
		message: string,
		public readonly duplicateIds: string[],
		public readonly totalToolUseCount: number,
	) {
		super(message)
		this.name = "DuplicateToolUseError"
	}
}

/**
 * Deduplicates tool_use blocks in an assistant message.
 *
 * This function removes duplicate tool_use blocks that have the same ID,
 * keeping only the first occurrence. This prevents Anthropic API errors
 * where duplicate tool_use IDs cause "unexpected tool_use_id" errors.
 *
 * The issue can occur in edge cases such as:
 * - Long waits during orchestrator sessions
 * - Race conditions during streaming
 * - Resume/delegation scenarios
 *
 * @param assistantMessage - The assistant message to deduplicate
 * @returns The message with duplicate tool_use blocks removed
 */
export function deduplicateToolUseBlocks(assistantMessage: Anthropic.MessageParam): Anthropic.MessageParam {
	// Only process assistant messages with array content
	if (assistantMessage.role !== "assistant" || !Array.isArray(assistantMessage.content)) {
		return assistantMessage
	}

	const seenToolUseIds = new Set<string>()
	const duplicateIds: string[] = []
	let totalToolUseCount = 0

	const deduplicatedContent = assistantMessage.content.filter((block) => {
		// Keep non-tool_use blocks as-is
		if (block.type !== "tool_use") {
			return true
		}

		totalToolUseCount++
		const toolUseBlock = block as Anthropic.ToolUseBlock

		// Guard against invalid/missing IDs - keep the block to avoid data loss
		if (typeof toolUseBlock.id !== "string" || toolUseBlock.id.length === 0) {
			return true
		}

		if (seenToolUseIds.has(toolUseBlock.id)) {
			// This is a duplicate - track it and filter it out
			duplicateIds.push(toolUseBlock.id)
			return false
		}

		seenToolUseIds.add(toolUseBlock.id)
		return true
	})

	// Report duplicates to telemetry if any were found
	if (duplicateIds.length > 0 && TelemetryService.hasInstance()) {
		const uniqueDuplicateIds = [...new Set(duplicateIds)]
		TelemetryService.instance.captureException(
			new DuplicateToolUseError(
				`Detected duplicate tool_use IDs in assistant message. Duplicate IDs: [${uniqueDuplicateIds.join(", ")}]`,
				uniqueDuplicateIds,
				totalToolUseCount,
			),
			{
				duplicateIds: uniqueDuplicateIds,
				totalToolUseCount,
				uniqueToolUseCount: seenToolUseIds.size,
			},
		)
	}

	// If no duplicates were found, return unchanged
	if (duplicateIds.length === 0) {
		return assistantMessage
	}

	return {
		...assistantMessage,
		content: deduplicatedContent,
	}
}
