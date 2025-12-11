import type { ClineMessage, TodoItem } from "@roo-code/types"

interface TodoMetadata {
	tool?: string
	todos?: TodoItem[]
}

/**
 * Extract the latest todos from a list of ClineMessages.
 * Checks both metadata (from CLI) and parsed text for todo data.
 */
export function extractTodosFromMessages(messages: ClineMessage[]): TodoItem[] {
	const todos = messages
		.filter(
			(msg) =>
				(msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && msg.say === "user_edit_todos"),
		)
		.map((msg) => {
			// Check metadata first (CLI sends tool info here)
			const metadata = msg.metadata as TodoMetadata | undefined
			if (metadata?.tool === "updateTodoList" && Array.isArray(metadata.todos)) {
				return { tool: "updateTodoList", todos: metadata.todos }
			}
			// Fall back to parsing text
			try {
				return JSON.parse(msg.text ?? "{}")
			} catch {
				return null
			}
		})
		.filter((item) => item && item.tool === "updateTodoList" && Array.isArray(item.todos))
		.map((item) => item.todos as TodoItem[])
		.pop()

	return todos ?? []
}
