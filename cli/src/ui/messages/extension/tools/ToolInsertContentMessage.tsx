import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { parseDiffContent, calculateDiffStats, parseInsertContent, isUnifiedDiffFormat } from "../diff.js"
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

	// Detect language from file path
	const language = useMemo(() => {
		return toolData.path ? detectLanguage(toolData.path) : null
	}, [toolData.path])

	// Get theme type for syntax highlighting
	const themeType: ThemeType = theme.type === "light" ? "light" : "dark"

	// Limit display lines (insert content is mostly additions, so just cap the display)
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
		</Box>
	)
}
