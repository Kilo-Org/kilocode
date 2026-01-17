import OpenAI from "openai"
import { findLast, findLastIndex } from "../../../shared/array"

function setCacheControl(message: OpenAI.ChatCompletionMessageParam) {
	if (typeof message.content === "string") {
		message.content = [
			{
				type: "text",
				text: message.content,
				// @ts-ignore-next-line
				cache_control: { type: "ephemeral" },
			},
		]
	} else if (Array.isArray(message.content)) {
		const lastItem = message.content.at(-1)
		if (lastItem) {
			// @ts-ignore-next-line
			lastItem.cache_control = { type: "ephemeral" }
		}
	}
}

export function addAnthropicCacheBreakpoints(
	_systemPrompt: string,
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
) {
	const systemPrompt = messages.find((msg) => msg.role === "system")
	if (systemPrompt) {
		setCacheControl(systemPrompt)
	}

	const lastUserMessage = findLast(messages, (msg) => msg.role === "user" || msg.role === "tool")
	if (lastUserMessage) {
		setCacheControl(lastUserMessage)
	}

	const lastAssistantIndex = findLastIndex(messages, (msg) => msg.role === "assistant")
	if (lastAssistantIndex >= 0) {
		const previousUserMessage = findLast(
			messages.slice(0, lastAssistantIndex),
			(msg) => msg.role === "user" || msg.role === "tool",
		)
		if (previousUserMessage) {
			setCacheControl(previousUserMessage)
		}
	}
}
