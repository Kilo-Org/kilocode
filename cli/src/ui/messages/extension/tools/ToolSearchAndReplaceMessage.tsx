import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath } from "../utils.js"
import { parseDiffContent, calculateDiffStats } from "../diff.js"
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
const CONTEXT_LINES = 3 // Lines of context around changes
const MIN_CONTEXT_LINES = 2 // Minimum context lines to show even for small diffs

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

	// Detect language from file path
	const language = useMemo(() => {
		return toolData.path ? detectLanguage(toolData.path) : null
	}, [toolData.path])

	// Get theme type for syntax highlighting
	const themeType: ThemeType = theme.type === "light" ? "light" : "dark"

	// Filter lines to show changes with context
	const displayLines = useMemo(() => {
		// Find indices of all changed lines (additions/deletions)
		const changedIndices = new Set<number>()
		parsedLines.forEach((line, index) => {
			if (line.type === "addition" || line.type === "deletion") {
				changedIndices.add(index)
			}
		})

		// If no changes, show all lines up to max
		if (changedIndices.size === 0) {
			return {
				lines: parsedLines.slice(0, MAX_DIFF_LINES),
				hasMore: parsedLines.length > MAX_DIFF_LINES,
				hiddenCount: Math.max(0, parsedLines.length - MAX_DIFF_LINES),
			}
		}

		// For small diffs, ensure we show at least MIN_CONTEXT_LINES around changes
		// This helps users understand the context of small updates
		const contextLines = Math.max(CONTEXT_LINES, MIN_CONTEXT_LINES)

		// Build set of indices to show (changes + context)
		const indicesToShow = new Set<number>()
		for (const idx of changedIndices) {
			for (
				let i = Math.max(0, idx - contextLines);
				i <= Math.min(parsedLines.length - 1, idx + contextLines);
				i++
			) {
				indicesToShow.add(i)
			}
		}

		// If the diff is small enough with context, show all
		if (parsedLines.length <= MAX_DIFF_LINES) {
			return {
				lines: parsedLines.slice(0, MAX_DIFF_LINES),
				hasMore: parsedLines.length > MAX_DIFF_LINES,
				hiddenCount: Math.max(0, parsedLines.length - MAX_DIFF_LINES),
			}
		}

		// Convert to sorted array and build display lines
		const sortedIndices = Array.from(indicesToShow).sort((a, b) => a - b)
		const result: typeof parsedLines = []
		let lastIdx = -1

		for (const idx of sortedIndices) {
			if (lastIdx !== -1 && idx > lastIdx + 1) {
				const gapSize = idx - lastIdx - 1
				result.push({
					type: "header",
					content: `  ... ${gapSize} unchanged line${gapSize > 1 ? "s" : ""} ...`,
				})
			}
			const line = parsedLines[idx]
			if (line) {
				result.push(line)
			}
			lastIdx = idx
			if (result.length >= MAX_DIFF_LINES) break
		}

		return {
			lines: result,
			hasMore: result.length < sortedIndices.length || parsedLines.length > sortedIndices.length,
			hiddenCount: parsedLines.length - indicesToShow.size,
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

		displayLines.lines.forEach((line, displayIndex) => {
			if (line.type === "addition" || line.type === "deletion" || line.type === "context") {
				codeLines.push(line.content)
				lineIndexMap.push(displayIndex)
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

			{/* Diff content with colored lines and syntax highlighting */}
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
