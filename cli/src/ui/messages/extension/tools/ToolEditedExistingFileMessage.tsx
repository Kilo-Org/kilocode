import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps, BatchDiffItem } from "../types.js"
import { formatFilePath } from "../utils.js"
import { parseDiffContent, calculateDiffStats } from "../diff.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { DiffLine } from "./DiffLine.js"

/**
 * Display file edits with diff (handles both editedExistingFile and appliedDiff tool types)
 * Uses compact format similar to modern CLI tools:
 * - Update(filename) header with diff stats
 * - Colored diff with line numbers
 */
export const ToolEditedExistingFileMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const isBatch = toolData.batchDiffs && toolData.batchDiffs.length > 0

	// Use content (unified diff) if available, otherwise fall back to diff (raw SEARCH/REPLACE)
	const diffContent = toolData.content || toolData.diff || ""

	// Parse diff content
	const parsedLines = useMemo(() => parseDiffContent(diffContent), [diffContent])

	// Calculate stats from parsed lines if not provided
	const stats = useMemo(() => {
		if (toolData.diffStats) return toolData.diffStats
		return calculateDiffStats(parsedLines)
	}, [toolData.diffStats, parsedLines])

	// Generate diff summary text
	const diffSummary = useMemo(() => {
		const parts: string[] = []
		if (stats.added > 0) {
			parts.push(`+${stats.added}`)
		}
		if (stats.removed > 0) {
			parts.push(`-${stats.removed}`)
		}
		return parts.length > 0 ? `⎿ ${parts.join(", ")}` : ""
	}, [stats])

	if (isBatch) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text color={theme.semantic.info} bold>
						⏺ Update ({toolData.batchDiffs!.length} files)
					</Text>
				</Box>
				<Box flexDirection="column" marginTop={1} marginLeft={2}>
					{toolData.batchDiffs!.map((batchDiff: BatchDiffItem, index: number) => (
						<Box key={index} flexDirection="row">
							<Text color={theme.ui.text.primary}>{formatFilePath(batchDiff.path || "")}</Text>
							{batchDiff.isProtected && (
								<Text color={theme.semantic.warning} dimColor>
									{" "}
									🔒
								</Text>
							)}
						</Box>
					))}
				</Box>
			</Box>
		)
	}

	// Determine if this is a new file or update
	const isNewFile = toolData.tool === "newFileCreated"
	const actionText = isNewFile ? "Create" : "Update"
	const icon = isNewFile ? "📄" : "⏺"

	return (
		<Box flexDirection="column" marginY={1}>
			{/* Compact header: ⏺ Update(filename) ⎿ +X, -Y */}
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} {actionText}(
				</Text>
				<Text color={theme.semantic.info} bold>
					{formatFilePath(toolData.path || "")}
				</Text>
				<Text color={theme.semantic.info} bold>
					)
				</Text>
				{toolData.isProtected && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						🔒
					</Text>
				)}
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠
					</Text>
				)}
				{diffSummary && (
					<Text color={theme.ui.text.dimmed} dimColor>
						{" "}
						{diffSummary}
					</Text>
				)}
			</Box>

			{/* Diff content with colored lines */}
			{parsedLines.length > 0 && (
				<Box width={getBoxWidth(3)} flexDirection="column" marginTop={1} marginLeft={2}>
					{parsedLines.slice(0, 20).map((line, index) => (
						<DiffLine key={index} line={line} theme={theme} showLineNumbers={true} />
					))}
					{parsedLines.length > 20 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({parsedLines.length - 20} more lines)
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
