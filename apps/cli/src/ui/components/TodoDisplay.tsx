import { memo } from "react"
import { Box, Text } from "ink"

import type { TodoItem } from "@roo-code/types"

import * as theme from "../theme.js"
import ProgressBar from "./ProgressBar.js"
import { Icon, type IconName } from "./Icon.js"

/**
 * Map TODO status to Icon names
 */
const STATUS_ICON_NAMES: Record<TodoItem["status"], IconName> = {
	completed: "checkbox-checked",
	in_progress: "checkbox-progress",
	pending: "checkbox",
}

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

interface TodoDisplayProps {
	/** List of TODO items to display */
	todos: TodoItem[]
	/** Previous TODO list for diff comparison (optional) */
	previousTodos?: TodoItem[]
	/** Whether to show the progress bar (default: true) */
	showProgress?: boolean
	/** Whether to show only changed items (default: false) */
	showChangesOnly?: boolean
	/** Title to display in the header (default: "Progress") */
	title?: string
}

/**
 * TodoDisplay component for CLI
 *
 * Renders a beautiful TODO list visualization with:
 * - Nerd Font icons (or ASCII fallbacks) for status
 * - Color-coded items based on status (green/yellow/gray)
 * - Progress bar showing completion percentage
 * - Optional diff mode showing only changed items
 * - Change indicators ([done], [started], [new])
 *
 * Visual example (with fallback icons):
 * ```
 *  ☑ Progress [████████░░░░░░░░] 2/5
 *    ✓ Analyze requirements [done]
 *    ✓ Design architecture [done]
 *    → Implement core logic
 *    ○ Write tests
 *    ○ Update documentation [new]
 * ```
 */
function TodoDisplay({
	todos,
	previousTodos = [],
	showProgress = true,
	showChangesOnly = false,
	title = "Progress",
}: TodoDisplayProps) {
	if (!todos || todos.length === 0) {
		return null
	}

	// Determine which todos to display
	let displayTodos: TodoItem[]

	if (showChangesOnly && previousTodos.length > 0) {
		// Filter to only show items that changed status
		displayTodos = todos.filter((todo) => {
			const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
			if (!previousTodo) {
				// New item
				return true
			}
			// Status changed
			return previousTodo.status !== todo.status
		})
	} else {
		displayTodos = todos
	}

	// If filtering and nothing changed, don't render
	if (showChangesOnly && displayTodos.length === 0) {
		return null
	}

	// Calculate progress statistics
	const totalCount = todos.length
	const completedCount = todos.filter((t) => t.status === "completed").length

	return (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			{/* Header with progress bar on same line */}
			<Box>
				<Icon name="todo-list" color={theme.toolHeader} />
				<Text color={theme.toolHeader} bold>
					{" "}
					{title}
				</Text>
				{showProgress && (
					<>
						<Text> </Text>
						<ProgressBar value={completedCount} max={totalCount} width={16} />
					</>
				)}
			</Box>

			{/* TODO items */}
			<Box flexDirection="column" paddingLeft={1} marginTop={1}>
				{displayTodos.map((todo, index) => {
					const iconName = STATUS_ICON_NAMES[todo.status] || STATUS_ICON_NAMES.pending
					const color = getStatusColor(todo.status)

					// Check if this item changed status
					const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
					const statusChanged = previousTodo && previousTodo.status !== todo.status
					const isNew = previousTodos.length > 0 && !previousTodo

					return (
						<Box key={todo.id || `todo-${index}`}>
							<Icon name={iconName} color={color} />
							<Text color={color}> {todo.content}</Text>
							{statusChanged && (
								<Text color={theme.dimText} dimColor>
									{" "}
									[
									{todo.status === "completed"
										? "done"
										: todo.status === "in_progress"
											? "started"
											: "reset"}
									]
								</Text>
							)}
							{isNew && (
								<Text color={theme.dimText} dimColor>
									{" "}
									[new]
								</Text>
							)}
						</Box>
					)
				})}
			</Box>
		</Box>
	)
}

export default memo(TodoDisplay)
