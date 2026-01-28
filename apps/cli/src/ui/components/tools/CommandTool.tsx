import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolIconName } from "./utils.js"

const MAX_OUTPUT_LINES = 10

export function CommandTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const command = toolData.command || ""
	const output = toolData.output ? sanitizeContent(toolData.output) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const displayOutput = output || content
	const { text: previewOutput, truncated, hiddenLines } = truncateText(displayOutput, MAX_OUTPUT_LINES)

	return (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				{command && (
					<Box marginLeft={1}>
						<Text color={theme.successColor}>$ </Text>
						<Text color={theme.text} bold>
							{command}
						</Text>
					</Box>
				)}
			</Box>
			{previewOutput && (
				<Box flexDirection="column">
					<Box flexDirection="column" borderStyle="single" borderColor={theme.borderColor} paddingX={1}>
						{previewOutput.split("\n").map((line, i) => (
							<Text key={i} color={theme.toolText}>
								{line}
							</Text>
						))}
					</Box>
					{truncated && (
						<Text color={theme.dimText} dimColor>
							... ({hiddenLines} more lines)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
