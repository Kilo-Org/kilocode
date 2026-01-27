import { memo } from "react"
import { Box, Text } from "ink"

import type { TodoItem } from "@roo-code/types"

import * as theme from "../theme.js"

/**
 * Status icons for TODO items using Unicode characters
 */
const STATUS_ICONS = {
	completed: "✓",
	in_progress: "→",
	pending: "○",
} as const

/**
 * Get the color for a TODO status
 */
function getStatusColor(status: TodoItem["status"]): string {
	switch (status) {
		case "completed":
			return theme.successColor
		case "in_progress":
			return theme.warningColor
		case "pending":
		default:
			return theme.dimText
	}
}

interface TodoChangeDisplayProps {
	/** Previous TODO list for comparison */
	previousTodos: TodoItem[]
	/** New TODO list */
	newTodos: TodoItem[]
}

/**
 * TodoChangeDisplay component for CLI
 *
 * Shows only the items that changed between two TODO lists.
 * Used for compact inline display in the chat history.
 *
 * Visual example:
 * ```
 * ☑ TODO Updated
 *   ✓ Design architecture      [completed]
 *   → Implement core logic     [started]
 * ```
 */
function TodoChangeDisplay({ previousTodos, newTodos }: TodoChangeDisplayProps) {
	if (!newTodos || newTodos.length === 0) {
		return null
	}

	const isInitialState = previousTodos.length === 0

	// Determine which todos to display
	let todosToDisplay: TodoItem[]

	if (isInitialState) {
		// For initial state, show all todos
		todosToDisplay = newTodos
	} else {
		// For updates, only show changes (completed or started items)
		todosToDisplay = newTodos.filter((newTodo) => {
			if (newTodo.status === "completed") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "completed"
			}
			if (newTodo.status === "in_progress") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "in_progress"
			}
			return false
		})
	}

	// If no changes to display, show nothing
	if (todosToDisplay.length === 0) {
		return null
	}

	// Calculate progress for summary
	const totalCount = newTodos.length
	const completedCount = newTodos.filter((t) => t.status === "completed").length

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header with progress summary */}
			<Box>
				<Text color={theme.toolHeader} bold>
					☑ TODO {isInitialState ? "List" : "Updated"}
				</Text>
				<Text color={theme.dimText}>
					{" "}
					({completedCount}/{totalCount})
				</Text>
			</Box>

			{/* Changed items */}
			<Box flexDirection="column" paddingLeft={2}>
				{todosToDisplay.map((todo, index) => {
					const icon = STATUS_ICONS[todo.status] || STATUS_ICONS.pending
					const color = getStatusColor(todo.status)

					// Determine what changed
					const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
					let changeLabel: string | null = null

					if (isInitialState) {
						// Don't show labels for initial state
						changeLabel = null
					} else if (!previousTodo) {
						changeLabel = "new"
					} else if (todo.status === "completed" && previousTodo.status !== "completed") {
						changeLabel = "done"
					} else if (todo.status === "in_progress" && previousTodo.status !== "in_progress") {
						changeLabel = "started"
					}

					return (
						<Box key={todo.id || `todo-${index}`}>
							<Text color={color}>
								{icon} {todo.content}
							</Text>
							{changeLabel && (
								<Text color={theme.dimText} dimColor>
									{" "}
									[{changeLabel}]
								</Text>
							)}
						</Box>
					)
				})}
			</Box>
		</Box>
	)
}

export default memo(TodoChangeDisplay)
