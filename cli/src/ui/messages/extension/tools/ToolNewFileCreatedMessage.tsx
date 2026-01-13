import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { calculateDiffStats, parseNewFileContent } from "../diff.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { DiffLine } from "./DiffLine.js"

/**
 * Display new file creation with content preview
 * Uses compact format: Create(filename) ⎿ +X lines
 */
export const ToolNewFileCreatedMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()

	// Use content (unified diff) if available, otherwise use raw content
	const diffContent = toolData.content || ""

	// Parse diff content or create simple line list
	const parsedLines = useMemo(() => parseNewFileContent(diffContent), [diffContent])

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
			{/* Compact header: 📄 Create(filename) ⎿ +X lines */}
			<Box>
				<Text color={theme.semantic.success} bold>
					📄 Create(
				</Text>
				<Text color={theme.semantic.success} bold>
					{formatFilePath(toolData.path || "")}
				</Text>
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

			{toolData.fastApplyResult && typeof toolData.fastApplyResult === "object" ? (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.success} dimColor>
						✓ Fast apply
					</Text>
				</Box>
			) : null}
		</Box>
	)
}
