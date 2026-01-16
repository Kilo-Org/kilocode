import { Anthropic } from "@anthropic-ai/sdk"

type ContentBlock = Anthropic.Messages.ContentBlockParam

/**
 * Merges text content (like environment_details) that follows tool_result blocks
 * into the last tool_result's content. This preserves reasoning continuity for
 * thinking models by avoiding separate user messages after tool results.
 *
 * Key behavior:
 * - User messages with ONLY tool_result blocks: keep as-is
 * - User messages with ONLY text/image: keep as-is
 * - User messages with tool_result blocks AND text blocks: merge the text blocks
 *   into the last tool_result's content
 *
 * @param messages Array of Anthropic messages
 * @returns Modified messages with text merged into tool_result content
 */
export function mergeEnvironmentDetailsForMiniMax(
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	const result: Anthropic.Messages.MessageParam[] = []

	for (const message of messages) {
		if (message.role === "user") {
			if (typeof message.content === "string") {
				// Simple string content - keep as-is
				result.push(message)
			} else if (Array.isArray(message.content)) {
				// Check if this message has both tool_result blocks and text blocks
				const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []
				const textBlocks: Anthropic.Messages.TextBlockParam[] = []
				const imageBlocks: Anthropic.Messages.ImageBlockParam[] = []

				for (const block of message.content) {
					if (block.type === "tool_result") {
						toolResultBlocks.push(block)
					} else if (block.type === "text") {
						textBlocks.push(block)
					} else if (block.type === "image") {
						imageBlocks.push(block)
					}
				}

				// If we have tool_result blocks AND text blocks (like environment_details),
				// merge the text into the last tool_result's content
				const hasToolResults = toolResultBlocks.length > 0
				const hasTextBlocks = textBlocks.length > 0
				const hasImageBlocks = imageBlocks.length > 0

				if (hasToolResults && hasTextBlocks && !hasImageBlocks) {
					// Merge text content into the last tool_result
					const textContent = textBlocks.map((b) => b.text).join("\n\n")
					const modifiedToolResults = [...toolResultBlocks]
					const lastToolResult = modifiedToolResults[modifiedToolResults.length - 1]

					// Get existing content as string
					let existingContent: string
					if (typeof lastToolResult.content === "string") {
						existingContent = lastToolResult.content
					} else if (Array.isArray(lastToolResult.content)) {
						existingContent =
							lastToolResult.content
								?.map((c) => {
									if (c.type === "text") return c.text
									if (c.type === "image") return "(image)"
									return ""
								})
								.join("\n") ?? ""
					} else {
						existingContent = ""
					}

					// Merge text into the last tool_result
					modifiedToolResults[modifiedToolResults.length - 1] = {
						...lastToolResult,
						content: existingContent ? `${existingContent}\n\n${textContent}` : textContent,
					}

					result.push({
						...message,
						content: modifiedToolResults as ContentBlock[],
					})
				} else {
					// Keep the message as-is if:
					// - Only tool_result blocks (no text to merge)
					// - Only text/image blocks (no tool results)
					// - Has images (can't merge into tool_result)
					result.push(message)
				}
			} else {
				// Unknown format - keep as-is
				result.push(message)
			}
		} else {
			// Assistant messages - keep as-is
			result.push(message)
		}
	}

	return result
}

/**
 * @deprecated Use mergeEnvironmentDetailsForMiniMax instead. This function extracted
 * environment_details to the system prompt, but the new approach merges them into
 * tool_result content like r1-format does with mergeToolResultText.
 */
export function extractEnvironmentDetailsForMiniMax(messages: Anthropic.Messages.MessageParam[]): {
	messages: Anthropic.Messages.MessageParam[]
	extractedSystemContent: string[]
} {
	// For backwards compatibility, just return the merged messages with empty extracted content
	return {
		messages: mergeEnvironmentDetailsForMiniMax(messages),
		extractedSystemContent: [],
	}
}
