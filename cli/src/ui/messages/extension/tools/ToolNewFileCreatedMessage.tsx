import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { calculateDiffStats, parseNewFileContent } from "../diff.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { DiffLine } from "./DiffLine.js"
import {
	detectLanguage,
	highlightCodeBlockSync,
	type HighlightedToken,
	type ThemeType,
} from "../../../utils/syntaxHighlight.js"

// Configuration for diff display
const MAX_DIFF_LINES = 50 // Maximum lines to show

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

	// Detect language from file path
	const language = useMemo(() => {
		return toolData.path ? detectLanguage(toolData.path) : null
	}, [toolData.path])

	// Get theme type for syntax highlighting
	const themeType: ThemeType = theme.type === "light" ? "light" : "dark"

	// Limit display lines (new file content is all additions, so just cap the display)
	const displayLines = useMemo(() => {
		return {
			lines: parsedLines.slice(0, MAX_DIFF_LINES),
			hasMore: parsedLines.length > MAX_DIFF_LINES,
			hiddenCount: Math.max(0, parsedLines.length - MAX_DIFF_LINES),
		}
	}, [parsedLines])

	// Generate highlighted tokens for all lines at once (preserves multiline context)
	// This ensures proper highlighting of template literals, multiline strings, etc.
	const highlightedLines = useMemo((): Map<number, HighlightedToken[] | null> => {
		const map = new Map<number, HighlightedToken[] | null>()
		if (!language) {
			return map
		}

		// Extract code content from lines that need highlighting
		const codeLines: string[] = []
		const lineIndexMap: number[] = [] // Maps code line index to display line index

		displayLines.lines.forEach((line, index) => {
			if (line.type === "addition" || line.type === "deletion" || line.type === "context") {
				codeLines.push(line.content)
				lineIndexMap.push(index)
			}
		})

		// Highlight all lines together to preserve multiline context
		const tokens = highlightCodeBlockSync(codeLines, language, themeType)
		if (tokens) {
			tokens.forEach((lineTokens, codeIndex) => {
				const displayIndex = lineIndexMap[codeIndex]
				if (displayIndex !== undefined) {
					map.set(displayIndex, lineTokens)
				}
			})
		}

		return map
	}, [displayLines, language, themeType])

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

			{/* Content preview with colored lines and syntax highlighting */}
			{displayLines.lines.length > 0 && (
				<Box width={getBoxWidth(3)} flexDirection="column" marginTop={1} marginLeft={2}>
					{displayLines.lines.map((line, index) => (
						<DiffLine
							key={index}
							line={line}
							theme={theme}
							showLineNumbers={true}
							highlightedTokens={highlightedLines.get(index) ?? null}
						/>
					))}
					{displayLines.hasMore && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({displayLines.hiddenCount} more lines)
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
