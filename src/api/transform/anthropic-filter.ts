import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Set of content block types that are valid for Anthropic API.
 * Only these types will be passed through to the API.
 * See: https://docs.anthropic.com/en/api/messages
 */
export const VALID_ANTHROPIC_BLOCK_TYPES = new Set([
	"text",
	"image",
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
	"document",
])

// kilocode_change start
/**
 * Filters out non-Anthropic content blocks from messages before sending to Anthropic/Vertex API.
 * Uses an allowlist approach - only blocks with types in VALID_ANTHROPIC_BLOCK_TYPES are kept.
 * This automatically filters out:
 * - Internal "reasoning" blocks (Roo Code's internal representation)
 * - Gemini's "thoughtSignature" blocks (encrypted reasoning continuity tokens)
 * - Any other unknown block types
 *
 * @param messages - The messages to filter
 * @param thinking - The Anthropic thinking config. When undefined (thinking disabled),
 *                   thinking/redacted_thinking blocks are stripped from history to prevent
 *                   the API error: "When thinking is disabled, an 'assistant' message cannot contain 'thinking'"
 */
export function filterNonAnthropicBlocks(
	messages: Anthropic.Messages.MessageParam[],
	thinking?: Anthropic.Messages.ThinkingConfigParam,
): Anthropic.Messages.MessageParam[] {
	// Build the set of allowed block types based on whether thinking is enabled
	const allowedTypes = new Set(VALID_ANTHROPIC_BLOCK_TYPES)

	// When thinking is undefined (disabled), remove thinking blocks from the allowlist
	if (thinking === undefined) {
		allowedTypes.delete("thinking")
		allowedTypes.delete("redacted_thinking")
	}
	// kilocode_change end

	return messages
		.map((message) => {
			if (typeof message.content === "string") {
				return message
			}

			const filteredContent = message.content.filter((block) => {
				const blockType = (block as { type: string }).type
				// Only keep block types that Anthropic recognizes
				// kilocode_change start
				return allowedTypes.has(blockType)
				// kilocode_change end
			})

			// If all content was filtered out, return undefined to filter the message later
			if (filteredContent.length === 0) {
				return undefined
			}

			return {
				...message,
				content: filteredContent,
			}
		})
		.filter((message): message is Anthropic.Messages.MessageParam => message !== undefined)
}
