import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display image generation request
 */
export const ToolGenerateImageMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("generateImage")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					{icon} Generate Image: {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isProtected && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						🔒 Protected
					</Text>
				)}
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠ Outside workspace
					</Text>
				)}
			</Box>

			{toolData.content && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Prompt:
					</Text>
					<Text color={theme.ui.text.primary}>{truncateText(toolData.content, 200)}</Text>
				</Box>
			)}
		</Box>
	)
}
