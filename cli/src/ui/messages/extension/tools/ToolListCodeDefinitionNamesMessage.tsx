import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display code definitions listing
 */
export const ToolListCodeDefinitionNamesMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("listCodeDefinitionNames")
	const definitions = toolData.content ? toolData.content.split("\n").filter((line) => line.trim()) : []

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					{icon} List Code Definitions: {formatFilePath(toolData.path || "")}
				</Text>
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠ Outside workspace
					</Text>
				)}
			</Box>

			{definitions.length > 0 && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{definitions.slice(0, 15).map((def, index) => (
						<Text key={index} color={theme.semantic.info}>
							{truncateText(def, 80)}
						</Text>
					))}
					{definitions.length > 15 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({definitions.length - 15} more definitions)
						</Text>
					)}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Total: {definitions.length} definitions
				</Text>
			</Box>
		</Box>
	)
}
