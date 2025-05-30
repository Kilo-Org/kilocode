import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Convert complex content blocks to simple string content
 */
export function convertToSimpleContent(content: Anthropic.Messages.MessageParam["content"]): string {
	if (typeof content === "string") {
		return content
	}

	// Extract text from content blocks
	return content
		.map((block) => {
			if (block.type === "text") {
				return block.text
			}
			if (block.type === "image") {
				return block.source.type === "url" ? `[Image: URL]` : `[Image: ${block.source.media_type}]` // kilocode_change
			}
			if (block.type === "tool_use") {
				return `[Tool Use: ${block.name}]`
			}
			if (block.type === "tool_result") {
				if (typeof block.content === "string") {
					return block.content
				}
				if (Array.isArray(block.content)) {
					return block.content
						.map((part) => {
							if (part.type === "text") {
								return part.text
							}
							if (part.type === "image") {
								// kilocode_change begin support type==url
								return part.source.type === "url"
									? `[Image: URL]`
									: `[Image: ${part.source.media_type}]`
								// kilocode_change end
							}
							return ""
						})
						.join("\n")
				}
				return ""
			}
			return ""
		})
		.filter(Boolean)
		.join("\n")
}

/**
 * Convert Anthropic messages to simple format with string content
 */
export function convertToSimpleMessages(
	messages: Anthropic.Messages.MessageParam[],
): Array<{ role: "user" | "assistant"; content: string }> {
	return messages.map((message) => ({
		role: message.role,
		content: convertToSimpleContent(message.content),
	}))
}
