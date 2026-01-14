import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { parseDiffContent, calculateDiffStats, parseInsertContent, isUnifiedDiffFormat } from "../diff.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { DiffLine } from "./DiffLine.js"

/**
 * Display content insertion at specific line
 * Uses compact format: + Insert(filename:line) ⎿ +X lines
 */
export const ToolInsertContentMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const lineText = toolData.lineNumber === 0 ? "end" : toolData.lineNumber?.toString() || ""

	// Use content (unified diff) if available, otherwise fall back to diff
	const diffContent = toolData.content || toolData.diff || ""

	// Parse diff content or create simple line list
	const parsedLines = useMemo(() => {
		if (!diffContent) return []

		// Check if it's a unified diff format
		if (isUnifiedDiffFormat(diffContent)) {
			return parseDiffContent(diffContent)
		}

		// Otherwise, treat as raw content - all lines are additions
		return parseInsertContent(diffContent, toolData.lineNumber || 1)
	}, [diffContent, toolData.lineNumber])

	// Calculate stats
	const stats = useMemo(() => {
		if (toolData.diffStats) return toolData.diffStats
		return calculateDiffStats(parsedLines)
	}, [toolData.diffStats, parsedLines])

	// Generate diff summary text
	const diffSummary = useMemo(() => {
		if (stats.added > 0) {
			return `⎿ +${stats.added} lines`
		}
		return ""
	}, [stats])

	return (
		<Box flexDirection="column" marginY={1}>
			{/* Compact header: + Insert(filename:line) ⎿ +X lines */}
			<Box>
				<Text color={theme.semantic.success} bold>
					+ Insert(
				</Text>
				<Text color={theme.semantic.success} bold>
					{formatFilePath(toolData.path || "")}
				</Text>
				{lineText && (
					<Text color={theme.semantic.success} bold>
						:{lineText}
					</Text>
				)}
				<Text color={theme.semantic.success} bold>
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

			{/* Content preview with colored lines */}
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
		</Box>
	)
}
