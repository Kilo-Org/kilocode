import { ChatMessage } from ".."

function messageIsEmpty(message: ChatMessage): boolean {
	if (typeof message.content === "string") {
		return message.content.trim() === ""
	}
	if (Array.isArray(message.content)) {
		return message.content.every((item) => item.type === "text" && item.text?.trim() === "")
	}
	return false
}

// some providers don't support empty messages
export function addSpaceToAnyEmptyMessages(messages: ChatMessage[]): ChatMessage[] {
	return messages.map((message) => {
		if (messageIsEmpty(message)) {
			message.content = " "
		}
		return message
	})
}

export function chatMessageIsEmpty(message: ChatMessage): boolean {
	switch (message.role) {
		case "system":
		case "user":
			return typeof message.content === "string" && message.content.trim() === ""
		case "assistant":
			return typeof message.content === "string" && message.content.trim() === ""
	}
}
