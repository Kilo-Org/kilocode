import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps, BatchDiffItem } from "../types.js"
import { getToolIcon, formatFilePath, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display file edits with diff (handles both editedExistingFile and appliedDiff tool types)
 */
export const ToolEditedExistingFileMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon(toolData.tool)
	const isBatch = toolData.batchDiffs && toolData.batchDiffs.length > 0

	if (isBatch) {
		return (
			<Box
				width={getBoxWidth(1)}
				flexDirection="column"
				borderStyle="single"
				borderColor={theme.semantic.info}
				paddingX={1}
				marginY={1}>
				<Box>
					<Text color={theme.semantic.info} bold>
						{icon} Edit Files ({toolData.batchDiffs!.length} files)
					</Text>
				</Box>
				<Box flexDirection="column" marginTop={1}>
					{toolData.batchDiffs!.map((batchDiff: BatchDiffItem, index: number) => (
						<Box key={index} flexDirection="column" marginBottom={1}>
							<Text color={theme.semantic.info}>{formatFilePath(batchDiff.path || "")}</Text>
							{batchDiff.isProtected && (
								<Text color={theme.semantic.warning} dimColor>
									{" "}
									🔒 Protected
								</Text>
							)}
						</Box>
					))}
				</Box>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Edit File: {formatFilePath(toolData.path || "")}
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

			{!!toolData.fastApplyResult && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.success} dimColor>
						✓ Fast apply
					</Text>
				</Box>
			)}
		</Box>
	)
}
