import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display search and replace operations
 */
export const ToolSearchAndReplaceMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("searchAndReplace")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					{icon} Search & Replace: {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isProtected && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						🔒 Protected
					</Text>
				)}
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
							const color = line.startsWith("+")
								? theme.code.addition
								: line.startsWith("-")
									? theme.code.deletion
									: line.startsWith("@@")
										? theme.semantic.info
										: theme.code.context
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
