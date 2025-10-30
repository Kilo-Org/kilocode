import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display recursive file listing
 */
export const ToolListFilesRecursiveMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("listFilesRecursive")
	const files = toolData.content ? toolData.content.split("\n").filter((line) => line.trim()) : []

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.actions.pending} bold>
					{icon} List Files (Recursive): {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠ Outside workspace
					</Text>
				)}
			</Box>

			{files.length > 0 && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{files.slice(0, 15).map((file, index) => (
						<Text key={index} color={theme.ui.text.dimmed}>
							{truncateText(file, 80)}
						</Text>
					))}
					{files.length > 15 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({files.length - 15} more items)
						</Text>
					)}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Total: {files.length} items
				</Text>
			</Box>
		</Box>
	)
}
