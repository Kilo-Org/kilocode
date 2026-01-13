import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { parseDiffContent, calculateDiffStats } from "../diff.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { DiffLine } from "./DiffLine.js"

/**
 * Display search and replace operations
 * Uses compact format: ⇄ Replace(filename) ⎿ +X, -Y
 */
export const ToolSearchAndReplaceMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()

	// Use content (unified diff) if available, otherwise fall back to diff
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

	return (
		<Box flexDirection="column" marginY={1}>
			{/* Compact header: ⇄ Replace(filename) ⎿ +X, -Y */}
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					⇄ Replace(
				</Text>
				<Text color={theme.ui.text.highlight} bold>
					{formatFilePath(toolData.path || "")}
				</Text>
				<Text color={theme.ui.text.highlight} bold>
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
		</Box>
	)
}
