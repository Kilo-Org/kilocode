import Anthropic from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence"

export function mergeApiMessages(message1: ApiMessage, message2: Anthropic.Messages.MessageParam) {
	const content = new Array<Anthropic.ContentBlockParam>()
	if (typeof message1.content === "string") {
		content.push({ type: "text", text: message1.content })
	} else {
		content.push(...message1.content)
	}
	if (typeof message2.content === "string") {
		content.push({ type: "text", text: message2.content })
	} else {
		content.push(...message2.content)
	}
	return { ...message1, content }
}

export function addOrMergeUserContent(
	messages: Anthropic.ContentBlockParam[],
	newUserContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[],
) {
	const result = [...messages]
	const lastIndex = result.length - 1
	const lastItem = result[lastIndex]
	if (lastItem && lastItem.type === "tool_result") {
		if (Array.isArray(lastItem.content)) {
			result[lastIndex] = {
				...lastItem,
				content: [...lastItem.content, ...newUserContent],
			}
		} else if (lastItem.content) {
			result[lastIndex] = {
				...lastItem,
				content: [{ type: "text", text: lastItem.content }, ...newUserContent],
			}
		} else {
			result[lastIndex] = { ...lastItem, content: newUserContent }
		}
	} else {
		result.push(...newUserContent)
	}
	return result
}
