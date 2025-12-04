import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { logs } from "../../../../services/logs.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display todo list updates with status indicators
 */
export const ToolUpdateTodoListMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("updateTodoList")

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return "✓"
			case "in_progress":
				return "⋯"
			case "pending":
			default:
				return "☐"
		}
	}

	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed":
				return theme.semantic.success
			case "in_progress":
				return theme.actions.pending
			case "pending":
			default:
				return theme.ui.text.dimmed
		}
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					{icon} Todo List Updated
				</Text>
			</Box>

			{toolData.todos && toolData.todos.length > 0 && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{toolData.todos.map((todo, index) => {
						logs.info("TODO", "ToolUpdateTodoListMessage", { todo })
						return (
							<Box key={index}>
								<Text color={getStatusColor(todo.status)}>{getStatusIcon(todo.status)} </Text>
								<MarkdownText>{todo.content}</MarkdownText>
							</Box>
						)
					})}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Legend: ✓ Completed ⋯ In Progress ☐ Pending
				</Text>
			</Box>
		</Box>
	)
}
