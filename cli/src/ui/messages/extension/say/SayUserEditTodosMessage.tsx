import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseToolData } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display user manually edited todos
 */
export const SayUserEditTodosMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const toolData = parseToolData(message)

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.semantic.info}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					☐ User Edited Todos
				</Text>
			</Box>

			{toolData?.todos && toolData.todos.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					{toolData.todos.map((todo, index) => {
						const statusIcon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "⋯" : "☐"
						const statusColor =
							todo.status === "completed"
								? theme.semantic.success
								: todo.status === "in_progress"
									? theme.actions.pending
									: theme.ui.text.dimmed

						return (
							<Box key={index} marginTop={index > 0 ? 0 : 0}>
								<Text color={statusColor}>
									{statusIcon} {todo.content}
								</Text>
							</Box>
						)
					})}
				</Box>
			)}

			{(!toolData?.todos || toolData.todos.length === 0) && message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}
		</Box>
	)
}
