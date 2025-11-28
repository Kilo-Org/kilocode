import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display new file creation with content preview
 */
export const ToolNewFileCreatedMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("newFileCreated")
	const lines = toolData.content ? toolData.content.split("\n") : []

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.success} bold>
					{icon} New File: {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isProtected && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						🔒 Protected
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
					{lines.slice(0, 10).map((line, index) => (
						<Text key={index} color={theme.ui.text.dimmed}>
							{truncateText(line, 80)}
						</Text>
					))}
					{lines.length > 10 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({lines.length - 10} more lines)
						</Text>
					)}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Lines: {lines.length}
				</Text>
			</Box>

			{toolData.fastApplyResult && typeof toolData.fastApplyResult === "object" ? (
				<Box marginLeft={2}>
					<Text color={theme.semantic.success} dimColor>
						✓ Fast apply
					</Text>
				</Box>
			) : null}
		</Box>
	)
}
