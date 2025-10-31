import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display regex file search results
 */
export const ToolSearchFilesMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("searchFiles")
	const results = toolData.content ? toolData.content.split("\n").filter((line) => line.trim()) : []

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Search Files: {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠ Outside workspace
					</Text>
				)}
			</Box>

			<Box marginLeft={2} flexDirection="column">
				{toolData.regex && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Pattern:{" "}
						</Text>
						<Text color={theme.ui.text.primary}>{toolData.regex}</Text>
					</Box>
				)}
				{toolData.filePattern && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Files:{" "}
						</Text>
						<Text color={theme.ui.text.primary}>{toolData.filePattern}</Text>
					</Box>
				)}
			</Box>

			{results.length > 0 && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{results.slice(0, 15).map((result, index) => (
						<Text key={index} color={theme.ui.text.dimmed}>
							{truncateText(result, 80)}
						</Text>
					))}
					{results.length > 15 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({results.length - 15} more results)
						</Text>
					)}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Found: {results.length} matches
				</Text>
			</Box>
		</Box>
	)
}
