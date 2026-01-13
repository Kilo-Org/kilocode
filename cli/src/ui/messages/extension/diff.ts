/**
 * Diff parsing and formatting utilities for CLI tool messages
 *
 * Supports two diff formats:
 * 1. Unified diff format (standard git diff with @@ hunk headers)
 * 2. SEARCH/REPLACE format (used by apply_diff tool)
 */

/**
 * Parsed diff line with type and content
 */
export interface ParsedDiffLine {
	type: "addition" | "deletion" | "context" | "header" | "marker"
	content: string
	oldLineNum?: number
	newLineNum?: number
}

/**
 * Diff stats interface
 */
export interface DiffStats {
	added: number
	removed: number
}

/**
 * Check if content is in unified diff format
 * Detects hunk headers (@@) or file headers (---)
 */
export function isUnifiedDiffFormat(content: string): boolean {
	return content.includes("@@") || content.startsWith("---")
}

/**
 * Parse diff content (supports both unified diff and SEARCH/REPLACE format)
 * Returns an array of parsed lines with type information for coloring
 */
export function parseDiffContent(diffContent: string): ParsedDiffLine[] {
	if (!diffContent) return []

	const lines = diffContent.split("\n")
	const result: ParsedDiffLine[] = []

	// Detect format: SEARCH/REPLACE uses <<<<<<< SEARCH markers
	const isSearchReplace = diffContent.includes("<<<<<<< SEARCH")

	if (isSearchReplace) {
		// Parse SEARCH/REPLACE format
		let inSearch = false
		let inReplace = false
		let oldLineNum = 1
		let newLineNum = 1

		for (const line of lines) {
			if (line.startsWith("<<<<<<< SEARCH")) {
				result.push({ type: "marker", content: line })
				inSearch = true
				inReplace = false
			} else if (line.startsWith(":start_line:")) {
				// Extract starting line number
				const match = line.match(/:start_line:(\d+)/)
				if (match && match[1]) {
					oldLineNum = parseInt(match[1], 10)
					newLineNum = oldLineNum
				}
				result.push({ type: "marker", content: line })
			} else if (line === "-------") {
				result.push({ type: "marker", content: line })
			} else if (line === "=======") {
				result.push({ type: "marker", content: line })
				inSearch = false
				inReplace = true
			} else if (line.startsWith(">>>>>>> REPLACE")) {
				result.push({ type: "marker", content: line })
				inSearch = false
				inReplace = false
			} else if (inSearch) {
				result.push({
					type: "deletion",
					content: line,
					oldLineNum: oldLineNum++,
				})
			} else if (inReplace) {
				result.push({
					type: "addition",
					content: line,
					newLineNum: newLineNum++,
				})
			} else {
				result.push({ type: "context", content: line })
			}
		}
	} else {
		// Parse unified diff format
		let oldLineNum = 1
		let newLineNum = 1

		for (const line of lines) {
			if (line.startsWith("@@")) {
				// Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
				const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
				if (match && match[1] && match[2]) {
					oldLineNum = parseInt(match[1], 10)
					newLineNum = parseInt(match[2], 10)
				}
				result.push({ type: "header", content: line })
			} else if (line.startsWith("---") || line.startsWith("+++")) {
				result.push({ type: "header", content: line })
			} else if (line.startsWith("+")) {
				result.push({
					type: "addition",
					content: line.slice(1),
					newLineNum: newLineNum++,
				})
			} else if (line.startsWith("-")) {
				result.push({
					type: "deletion",
					content: line.slice(1),
					oldLineNum: oldLineNum++,
				})
			} else if (line.startsWith(" ")) {
				result.push({
					type: "context",
					content: line.slice(1),
					oldLineNum: oldLineNum++,
					newLineNum: newLineNum++,
				})
			} else {
				// Lines without prefix (could be context or other)
				result.push({ type: "context", content: line })
			}
		}
	}

	return result
}

/**
 * Calculate diff stats from parsed diff lines
 */
export function calculateDiffStats(lines: ParsedDiffLine[]): DiffStats {
	let added = 0
	let removed = 0

	for (const line of lines) {
		if (line.type === "addition") added++
		if (line.type === "deletion") removed++
	}

	return { added, removed }
}

/**
 * Format diff stats as a summary string for display
 *
 * Two formats supported:
 * - "additions-only": For new files/inserts, shows "⎿ +X lines"
 * - "full": For edits, shows "⎿ +X, -Y" (only non-zero values)
 *
 * @param stats - The diff stats to format
 * @param format - The format style: "additions-only" or "full" (default: "full")
 * @returns Formatted summary string, or empty string if no changes
 */
export function formatDiffSummary(stats: DiffStats, format: "additions-only" | "full" = "full"): string {
	if (format === "additions-only") {
		if (stats.added > 0) {
			return `⎿ +${stats.added} lines`
		}
		return ""
	}

	// Full format: show both additions and removals
	const parts: string[] = []
	if (stats.added > 0) {
		parts.push(`+${stats.added}`)
	}
	if (stats.removed > 0) {
		parts.push(`-${stats.removed}`)
	}
	return parts.length > 0 ? `⎿ ${parts.join(", ")}` : ""
}

/**
 * Parse raw content as insertion lines (all additions)
 * Used for insert_content tool where all lines are new additions
 *
 * @param content - The raw content to parse
 * @param startLine - The starting line number (defaults to 1)
 * @returns Array of parsed diff lines, all marked as additions
 */
export function parseInsertContent(content: string, startLine: number = 1): ParsedDiffLine[] {
	if (!content) return []

	const lines = content.split("\n")
	return lines.map(
		(lineContent, index): ParsedDiffLine => ({
			type: "addition",
			content: lineContent,
			newLineNum: startLine + index,
		}),
	)
}

/**
 * Parse new file content - handles both unified diff and raw content
 * Used for new file creation where all content is additions
 *
 * @param content - The content to parse (unified diff or raw)
 * @returns Array of parsed diff lines
 */
export function parseNewFileContent(content: string): ParsedDiffLine[] {
	if (!content) return []

	// Check if it's a unified diff format
	if (isUnifiedDiffFormat(content)) {
		return parseDiffContent(content)
	}

	// Otherwise, treat as raw file content - all lines are additions starting at line 1
	return parseInsertContent(content, 1)
}
