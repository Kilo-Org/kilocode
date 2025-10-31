import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display content insertion at specific line
 */
export const ToolInsertContentMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("insertContent")
	const lineText = toolData.lineNumber === 0 ? "end of file" : `line ${toolData.lineNumber}`

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.success} bold>
					{icon} Insert Content: {formatFilePath(toolData.path || "")}
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

			<Box marginLeft={2}>
				<Text color={theme.ui.text.dimmed} dimColor>
					At {lineText}
				</Text>
			</Box>

			{toolData.diff && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{toolData.diff
						.split("\n")
						.slice(0, 10)
						.map((line, index) => {
							const color = line.startsWith("+") ? theme.code.addition : theme.code.context
							return (
								<Text key={index} color={color}>
									{truncateText(line, 80)}
								</Text>
							)
						})}
					{toolData.diff.split("\n").length > 10 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({toolData.diff.split("\n").length - 10} more lines)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
