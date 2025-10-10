import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseImageData, getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display image with path information
 */
export const SayImageMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("say", "image")
	const imageData = parseImageData(message)

	if (!imageData) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.info} bold>
					{icon} Image (invalid data)
				</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Image
				</Text>
			</Box>

			{imageData.imagePath && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.primary}>Path: {imageData.imagePath}</Text>
				</Box>
			)}

			{imageData.imageUri && (
				<Box marginLeft={2}>
					<Text color={theme.ui.text.dimmed} dimColor>
						URI: {imageData.imageUri.substring(0, 60)}
						{imageData.imageUri.length > 60 ? "..." : ""}
					</Text>
				</Box>
			)}
		</Box>
	)
}
