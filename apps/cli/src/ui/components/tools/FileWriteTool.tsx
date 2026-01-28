import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolDisplayName, getToolIconName, parseDiff } from "./utils.js"

const MAX_DIFF_LINES = 15

export function FileWriteTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)
	const path = toolData.path || ""
	const diffStats = toolData.diffStats
	const diff = toolData.diff ? sanitizeContent(toolData.diff) : ""
	const isProtected = toolData.isProtected
	const isOutsideWorkspace = toolData.isOutsideWorkspace
	const isNewFile = toolData.tool === "newFileCreated" || toolData.tool === "write_to_file"

	// Handle batch diff operations
	if (toolData.batchDiffs && toolData.batchDiffs.length > 0) {
		return (
			<Box flexDirection="column" paddingX={1}>
				{/* Header */}
				<Box>
					<Icon name={iconName} color={theme.toolHeader} />
					<Text bold color={theme.toolHeader}>
						{" "}
						{displayName}
					</Text>
					<Text color={theme.dimText}> ({toolData.batchDiffs.length} files)</Text>
				</Box>

				{/* File list with stats */}
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					{toolData.batchDiffs.slice(0, 8).map((file, index) => (
						<Box key={index}>
							<Text color={theme.text} bold>
								{file.path}
							</Text>
							{file.diffStats && (
								<Box marginLeft={1}>
									<Text color={theme.successColor}>+{file.diffStats.added}</Text>
									<Text color={theme.dimText}> / </Text>
									<Text color={theme.errorColor}>-{file.diffStats.removed}</Text>
								</Box>
							)}
						</Box>
					))}
					{toolData.batchDiffs.length > 8 && (
						<Text color={theme.dimText}>... and {toolData.batchDiffs.length - 8} more files</Text>
					)}
				</Box>
			</Box>
		)
	}

	// Single file write
	const { text: previewDiff, truncated, hiddenLines } = truncateText(diff, MAX_DIFF_LINES)
	const diffHunks = diff ? parseDiff(diff) : []

	return (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			{/* Header row with path on same line */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{displayName}
				</Text>
				{path && (
					<>
						<Text color={theme.dimText}> · </Text>
						<Text color={theme.text} bold>
							{path}
						</Text>
					</>
				)}
				{isNewFile && (
					<Text color={theme.successColor} bold>
						{" "}
						NEW
					</Text>
				)}

				{/* Diff stats badge */}
				{diffStats && (
					<>
						<Text color={theme.dimText}> </Text>
						<Text color={theme.successColor} bold>
							+{diffStats.added}
						</Text>
						<Text color={theme.dimText}>/</Text>
						<Text color={theme.errorColor} bold>
							-{diffStats.removed}
						</Text>
					</>
				)}

				{/* Warning badges */}
				{isProtected && <Text color={theme.errorColor}> 🔒 protected</Text>}
				{isOutsideWorkspace && (
					<Text color={theme.warningColor} dimColor>
						{" "}
						⚠ outside workspace
					</Text>
				)}
			</Box>

			{/* Diff preview */}
			{diffHunks.length > 0 && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					{diffHunks.slice(0, 2).map((hunk, hunkIndex) => (
						<Box key={hunkIndex} flexDirection="column">
							{/* Hunk header */}
							<Text color={theme.focusColor} dimColor>
								{hunk.header}
							</Text>

							{/* Diff lines */}
							{hunk.lines.slice(0, 8).map((line, lineIndex) => (
								<Text
									key={lineIndex}
									color={
										line.type === "added"
											? theme.successColor
											: line.type === "removed"
												? theme.errorColor
												: theme.toolText
									}>
									{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
									{line.content}
								</Text>
							))}

							{hunk.lines.length > 8 && (
								<Text color={theme.dimText} dimColor>
									... ({hunk.lines.length - 8} more lines in hunk)
								</Text>
							)}
						</Box>
					))}

					{diffHunks.length > 2 && (
						<Text color={theme.dimText} dimColor>
							... ({diffHunks.length - 2} more hunks)
						</Text>
					)}
				</Box>
			)}

			{/* Fallback to raw diff if no hunks parsed */}
			{diffHunks.length === 0 && previewDiff && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.toolText}>{previewDiff}</Text>
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
