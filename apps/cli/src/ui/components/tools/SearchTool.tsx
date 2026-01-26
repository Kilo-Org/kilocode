import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolDisplayName, getToolIconName } from "./utils.js"

const MAX_RESULT_LINES = 15

export function SearchTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)
	const regex = toolData.regex || ""
	const query = toolData.query || ""
	const filePattern = toolData.filePattern || ""
	const path = toolData.path || ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""

	// Parse search results if content looks like results.
	const resultLines = content.split("\n").filter((line) => line.trim())
	const matchCount = resultLines.length

	const { text: previewContent, truncated, hiddenLines } = truncateText(content, MAX_RESULT_LINES)

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{" "}
					{displayName}
				</Text>
				{matchCount > 0 && <Text color={theme.dimText}> ({matchCount} matches)</Text>}
			</Box>

			{/* Search parameters */}
			<Box flexDirection="column" marginLeft={2}>
				{/* Regex/Query */}
				{regex && (
					<Box>
						<Text color={theme.dimText}>regex: </Text>
						<Text color={theme.warningColor} bold>
							{regex}
						</Text>
					</Box>
				)}
				{query && (
					<Box>
						<Text color={theme.dimText}>query: </Text>
						<Text color={theme.warningColor} bold>
							{query}
						</Text>
					</Box>
				)}

				{/* Search scope */}
				<Box>
					{path && (
						<>
							<Text color={theme.dimText}>path: </Text>
							<Text color={theme.text}>{path}</Text>
						</>
					)}
					{filePattern && (
						<>
							<Text color={theme.dimText}> pattern: </Text>
							<Text color={theme.text}>{filePattern}</Text>
						</>
					)}
				</Box>
			</Box>

			{/* Results */}
			{previewContent && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.dimText} bold>
						Results:
					</Text>
					<Box flexDirection="column" marginTop={0}>
						{previewContent.split("\n").map((line, i) => {
							// Try to highlight file:line patterns
							const match = line.match(/^([^:]+):(\d+):(.*)$/)
							if (match) {
								const [, file, lineNum, context] = match
								return (
									<Box key={i}>
										<Text color={theme.focusColor}>{file}</Text>
										<Text color={theme.dimText}>:</Text>
										<Text color={theme.warningColor}>{lineNum}</Text>
										<Text color={theme.dimText}>:</Text>
										<Text color={theme.toolText}>{context}</Text>
									</Box>
								)
							}
							return (
								<Text key={i} color={theme.toolText}>
									{line}
								</Text>
							)
						})}
					</Box>
					{truncated && (
						<Text color={theme.dimText} dimColor>
							... ({hiddenLines} more results)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
