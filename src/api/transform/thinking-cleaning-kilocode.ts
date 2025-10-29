import { ApiMessage } from "../../core/task-persistence/apiMessages"
import { ApiHandler } from "../index"

export function maybeRemoveThinkingBlocks_kilocode(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	const keepThinking = apiHandler.getModel()?.id.toLowerCase().startsWith("minimax")
	if (keepThinking) {
		return messages
	}
	return messages
		.map((message) => {
			let { content } = message
			if (Array.isArray(content)) {
				content = content.filter((block) => block.type !== "thinking")
			}
			return { ...message, content }
		})
		.filter((message) => !Array.isArray(message.content) || message.content.length > 0)
}
