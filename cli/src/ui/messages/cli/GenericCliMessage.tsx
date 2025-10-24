import React from "react"
import { Box, Text } from "ink"
import type { CliMessage } from "../../../types/cli.js"
import { MarkdownText } from "../../components/MarkdownText.js"
import { useTheme } from "../../../state/hooks/useTheme.js"

interface GenericCliMessageProps {
	message: CliMessage
}

export const GenericCliMessage: React.FC<GenericCliMessageProps> = ({ message }) => {
	const theme = useTheme()

	const getColor = () => {
		switch (message.type) {
			case "user":
				return theme.messages.user
			case "assistant":
				return theme.messages.assistant
			case "system":
				return theme.messages.system
			case "error":
				return theme.messages.error
			default:
				return theme.ui.text.primary
		}
	}

	const getPrefix = () => {
		switch (message.type) {
			case "user":
				return "→"
			case "assistant":
				return "←"
			case "system":
				return "ℹ"
			case "error":
				return "✗"
			default:
				return " "
		}
	}

	// Don't render if there's no content
	if (!message.content) {
		return null
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={getColor()} bold>
					{getPrefix()}
					{"  "}
				</Text>
				<MarkdownText>{message.content}</MarkdownText>
				{message.partial && (
					<Text color={theme.ui.text.dimmed} dimColor>
						{" "}
						...
					</Text>
				)}
			</Box>
		</Box>
	)
}
