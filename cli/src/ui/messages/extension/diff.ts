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

function parseSearchReplaceFormat(lines: string[]): ParsedDiffLine[] {
	const result: ParsedDiffLine[] = []
	let inSearch = false
	let inReplace = false
	let oldLineNum = 1
	let newLineNum = 1

	for (const line of lines) {
		if (line.startsWith("<<<<<<< SEARCH")) {
			// Skip marker - don't add to result
			inSearch = true
			inReplace = false
		} else if (line.startsWith(":start_line:")) {
			const match = line.match(/:start_line:(\d+)/)
			if (match && match[1]) {
				oldLineNum = parseInt(match[1], 10)
				newLineNum = oldLineNum
			}
			// Skip marker - don't add to result
		} else if (line === "-------") {
			// Skip marker - don't add to result
		} else if (line === "=======") {
			// Skip marker - don't add to result
			inSearch = false
			inReplace = true
		} else if (line.startsWith(">>>>>>> REPLACE")) {
			// Skip marker - don't add to result
			inSearch = false
			inReplace = false
		} else if (inSearch) {
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
			result.push({ type: "addition", content: line.slice(1), newLineNum: newLineNum++ })
		} else if (line.startsWith("-")) {
			result.push({ type: "deletion", content: line.slice(1), oldLineNum: oldLineNum++ })
		} else if (line.startsWith(" ")) {
			result.push({ type: "context", content: line.slice(1), oldLineNum: oldLineNum++, newLineNum: newLineNum++ })
		} else {
			result.push({ type: "context", content: line })
		}
	}

	return result
}

export function parseDiffContent(diffContent: string): ParsedDiffLine[] {
	if (!diffContent) return []

	const lines = diffContent.split("\n")
	const isSearchReplace = diffContent.includes("<<<<<<< SEARCH")

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
