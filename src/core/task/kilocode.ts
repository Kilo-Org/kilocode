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
