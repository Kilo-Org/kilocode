import { Box, Text } from "ink"

import * as theme from "../../theme.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent } from "./utils.js"

const MAX_CONTENT_LINES = 15

export function CompletionTool({ toolData }: ToolRendererProps) {
	const result = toolData.result ? sanitizeContent(toolData.result) : ""
	const question = toolData.question ? sanitizeContent(toolData.question) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const isQuestion = toolData.tool.includes("question") || toolData.tool.includes("Question")
	const displayContent = result || question || content
	const { text: previewContent, truncated, hiddenLines } = truncateText(displayContent, MAX_CONTENT_LINES)

	return previewContent ? (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			{isQuestion ? (
				<Box flexDirection="column">
					<Text color={theme.text}>{previewContent}</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					{previewContent.split("\n").map((line, i) => (
						<Text key={i} color={theme.toolText}>
							{line}
						</Text>
					))}
				</Box>
			)}
			{truncated && (
				<Text color={theme.dimText} dimColor>
					... ({hiddenLines} more lines)
				</Text>
			)}
		</Box>
	) : null
}
