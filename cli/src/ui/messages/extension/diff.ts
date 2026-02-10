/**
 * Diff parsing and formatting utilities for CLI tool messages.
 * Supports unified diff format (@@ hunk headers) and SEARCH/REPLACE format.
 */

export interface ParsedDiffLine {
	type: "addition" | "deletion" | "context" | "header" | "marker"
	content: string
	oldLineNum?: number
	newLineNum?: number
}

export interface DiffStats {
	added: number
	removed: number
}

export function isUnifiedDiffFormat(content: string): boolean {
	return content.includes("@@") || content.startsWith("---")
}

/**
 * Check if a line is a partial/incomplete SEARCH/REPLACE marker from streaming,
 * or a git merge conflict marker that should be filtered out.
 *
 * These markers appear when content is being streamed and should be filtered out.
 *
 * Examples of partial markers:
 * - "<<<<" (partial start of "<<<<<<< SEARCH")
 * - "<<<<<<< S" (incomplete "<<<<<<< SEARCH")
 * - ">>>>>>" (partial ">>>>>>> REPLACE")
 * - "===" (partial "=======")
 *
 * Git merge conflict markers (also filtered):
 * - "<<<<<<< Updated upstream"
 * - "<<<<<<< HEAD"
 * - ">>>>>>> Stashed changes"
 * - ">>>>>>> branch-name"
 * - "=======" (conflict separator)
 *
 * Also handles escaped markers (with backslash prefix):
 * - "\<<<<<<< Updated upstream"
 * - "\======="
 * - "\>>>>>>> Stashed changes"
 */
function isPartialSearchReplaceMarker(line: string): boolean {
	// Strip leading backslash if present (escaped markers)
	const normalizedLine = line.startsWith("\\") ? line.slice(1) : line

	// Also strip leading/trailing whitespace for detection purposes
	// This handles cases like "               <<<<" from the bug report
	const trimmedLine = normalizedLine.trim()

	// Complete SEARCH/REPLACE markers - these are handled by the main parser in parseSearchReplaceFormat
	// Note: We don't return false for "=======" here because it could be a git conflict separator
	// that should be filtered when it appears as content in unified diff format
	if (trimmedLine.startsWith("<<<<<<< SEARCH") || trimmedLine.startsWith(">>>>>>> REPLACE")) {
		return false
	}

	// Git merge conflict markers - filter these out completely
	// They look like "<<<<<<< Updated upstream", "<<<<<<< HEAD", ">>>>>>> Stashed changes", etc.
	if (/^<{7}\s+\S/.test(trimmedLine)) {
		// "<<<<<<< " followed by any text (git conflict start marker)
		return true
	}
	if (/^>{7}\s+\S/.test(trimmedLine)) {
		// ">>>>>>> " followed by any text (git conflict end marker)
		return true
	}

	// Partial start marker: lines that are only < characters (1-7) or start with < and look like incomplete marker
	// But NOT legitimate content like HTML tags "<div>" or comparison operators
	if (/^<{1,7}$/.test(trimmedLine)) {
		return true // Just angle brackets like "<<<<" or "<<<<<<<"
	}
	if (/^<{4,7}\s*\S*$/.test(trimmedLine) && !trimmedLine.includes(">")) {
		// Looks like "<<<<<<< S" or "<<<<<<< SE" but not complete "<<<<<<< SEARCH"
		return true
	}

	// Partial end marker: lines that are only > characters (1-7) or start with > and look like incomplete marker
	// But NOT legitimate content like HTML closing tags or shell redirects
	if (/^>{1,7}$/.test(trimmedLine)) {
		return true // Just angle brackets like ">>>>>>" or ">>>>>>>"
	}
	if (/^>{4,7}\s*\S*$/.test(trimmedLine) && !trimmedLine.includes("<")) {
		// Looks like ">>>>>>> R" or ">>>>>>> RE" but not complete ">>>>>>> REPLACE"
		return true
	}

	// Separator: lines that are only = characters (3-7)
	// This includes both partial separators and the complete "=======" git conflict separator
	if (/^={3,7}$/.test(trimmedLine)) {
		return true
	}

	return false
}

function parseSearchReplaceFormat(lines: string[]): ParsedDiffLine[] {
	const result: ParsedDiffLine[] = []
	let inSearch = false
	let inReplace = false
	let oldLineNum = 1
	let newLineNum = 1

	for (const line of lines) {
		// Handle SEARCH/REPLACE format markers first (before filtering)
		if (line.startsWith("<<<<<<< SEARCH")) {
			// Skip marker - don't add to result
			inSearch = true
			inReplace = false
			continue
		}
		if (line.startsWith(":start_line:")) {
			const match = line.match(/:start_line:(\d+)/)
			if (match && match[1]) {
				oldLineNum = parseInt(match[1], 10)
				newLineNum = oldLineNum
			}
			// Skip marker - don't add to result
			continue
		}
		if (line === "-------") {
			// Skip marker - don't add to result
			continue
		}
		if (line === "=======" && (inSearch || !inReplace)) {
			// This is the SEARCH/REPLACE separator, not a git conflict marker
			// Skip marker - don't add to result
			inSearch = false
			inReplace = true
			continue
		}
		if (line.startsWith(">>>>>>> REPLACE")) {
			// Skip marker - don't add to result
			inSearch = false
			inReplace = false
			continue
		}

		// Filter out partial/incomplete markers from streaming
		if (isPartialSearchReplaceMarker(line)) {
			continue
		}

		if (inSearch) {
			result.push({ type: "deletion", content: line, oldLineNum: oldLineNum++ })
		} else if (inReplace) {
			result.push({ type: "addition", content: line, newLineNum: newLineNum++ })
		} else {
			result.push({ type: "context", content: line })
		}
	}

	return result
}

function parseUnifiedDiffFormat(lines: string[]): ParsedDiffLine[] {
	const result: ParsedDiffLine[] = []
	let oldLineNum = 1
	let newLineNum = 1

	for (const line of lines) {
		if (line.startsWith("@@")) {
			const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
			if (match && match[1] && match[2]) {
				oldLineNum = parseInt(match[1], 10)
				newLineNum = parseInt(match[2], 10)
			}
			result.push({ type: "header", content: line })
		} else if (line.startsWith("---") || line.startsWith("+++")) {
			result.push({ type: "header", content: line })
		} else if (line.startsWith("+")) {
			const content = line.slice(1)
			// Filter out partial/incomplete markers and git conflict markers from additions
			if (isPartialSearchReplaceMarker(content)) {
				continue
			}
			result.push({ type: "addition", content, newLineNum: newLineNum++ })
		} else if (line.startsWith("-")) {
			const content = line.slice(1)
			// Filter out partial/incomplete markers and git conflict markers from deletions
			if (isPartialSearchReplaceMarker(content)) {
				continue
			}
			result.push({ type: "deletion", content, oldLineNum: oldLineNum++ })
		} else if (line.startsWith(" ")) {
			const content = line.slice(1)
			// Filter out partial/incomplete markers and git conflict markers from context
			if (isPartialSearchReplaceMarker(content)) {
				continue
			}
			result.push({ type: "context", content, oldLineNum: oldLineNum++, newLineNum: newLineNum++ })
		} else {
			// Filter out partial/incomplete markers and git conflict markers
			if (isPartialSearchReplaceMarker(line)) {
				continue
			}
			result.push({ type: "context", content: line })
		}
	}

	return result
}

/**
 * Check if content looks like SEARCH/REPLACE format (complete or partial).
 * This helps route streaming content to the correct parser.
 */
function isSearchReplaceFormat(content: string): boolean {
	// Complete marker
	if (content.includes("<<<<<<< SEARCH")) {
		return true
	}

	// Partial markers that indicate SEARCH/REPLACE format during streaming
	// Look for 4+ consecutive < or > characters at the start of a line
	if (/^<{4,}/m.test(content) || /^>{4,}/m.test(content)) {
		return true
	}

	return false
}

export function parseDiffContent(diffContent: string): ParsedDiffLine[] {
	if (!diffContent) return []

	const lines = diffContent.split("\n")
	const isSearchReplace = isSearchReplaceFormat(diffContent)

	return isSearchReplace ? parseSearchReplaceFormat(lines) : parseUnifiedDiffFormat(lines)
}

export function calculateDiffStats(lines: ParsedDiffLine[]): DiffStats {
	let added = 0
	let removed = 0

	for (const line of lines) {
		if (line.type === "addition") added++
		if (line.type === "deletion") removed++
	}

	return { added, removed }
}

export function formatDiffSummary(stats: DiffStats, format: "additions-only" | "full" = "full"): string {
	if (format === "additions-only") {
		return stats.added > 0 ? `⎿ +${stats.added} lines` : ""
	}

	const parts: string[] = []
	if (stats.added > 0) parts.push(`+${stats.added}`)
	if (stats.removed > 0) parts.push(`-${stats.removed}`)
	return parts.length > 0 ? `⎿ ${parts.join(", ")}` : ""
}

export function parseInsertContent(content: string, startLine: number = 1): ParsedDiffLine[] {
	if (!content) return []

	return content.split("\n").map(
		(lineContent, index): ParsedDiffLine => ({
			type: "addition",
			content: lineContent,
			newLineNum: startLine + index,
		}),
	)
}

export function parseNewFileContent(content: string): ParsedDiffLine[] {
	if (!content) return []

	if (isUnifiedDiffFormat(content)) {
		return parseDiffContent(content)
	}

	return parseInsertContent(content, 1)
}
