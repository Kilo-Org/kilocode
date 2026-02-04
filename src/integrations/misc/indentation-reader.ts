/**
 * Indentation-based semantic code block extraction.
 *
 * Inspired by Codex's indentation mode, this module extracts meaningful code blocks
 * based on indentation hierarchy rather than arbitrary line ranges.
 *
 * The algorithm uses bidirectional expansion from an anchor line:
 * 1. Parse the file to determine indentation level of each line
 * 2. Compute effective indents (blank lines inherit previous non-blank line's indent)
 * 3. Expand up and down from anchor simultaneously
 * 4. Apply sibling exclusion counters to limit scope
 * 5. Trim empty lines from edges
 * 6. Apply line limit
 */

import {
	DEFAULT_LINE_LIMIT,
	DEFAULT_MAX_LEVELS,
	MAX_LINE_LENGTH,
} from "../../core/prompts/tools/native-tools/read_file"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineRecord {
	/** 1-based line number */
	lineNumber: number
	/** Original line content */
	content: string
	/** Computed indentation level (number of leading whitespace units) */
	indentLevel: number
	/** Whether this line is blank (empty or whitespace only) */
	isBlank: boolean
	/** Whether this line starts a new block (has content followed by colon, brace, etc.) */
	isBlockStart: boolean
}

export interface IndentationReadOptions {
	/** 1-based anchor line number */
	anchorLine: number
	/** Maximum indentation levels to include above anchor (0 = unlimited, default: 0) */
	maxLevels?: number
	/** Include sibling blocks at the same indentation level (default: false) */
	includeSiblings?: boolean
	/** Include file header content (imports, comments at top) (default: true) */
	includeHeader?: boolean
	/** Maximum lines to return from bidirectional expansion (default: 2000) */
	limit?: number
	/** Hard cap on lines returned, separate from limit (optional) */
	maxLines?: number
}

export interface IndentationReadResult {
	/** The extracted content with line numbers */
	content: string
	/** Line ranges that were included [start, end] tuples (1-based) */
	includedRanges: Array<[number, number]>
	/** Total lines in the file */
	totalLines: number
	/** Lines actually returned */
	returnedLines: number
	/** Whether output was truncated due to limit */
	wasTruncated: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Indentation unit size (spaces) */
const INDENT_SIZE = 4

/** Tab width for indent measurement (Codex standard) */
const TAB_WIDTH = 4

/** Patterns that indicate a block start */
const BLOCK_START_PATTERNS = [
	/:\s*$/, // Python-style (def foo():)
	/\{\s*$/, // C-style opening brace
	/=>\s*\{?\s*$/, // Arrow functions
	/\bthen\s*$/, // Lua/some languages
	/\bdo\s*$/, // Ruby, Lua
]

/** Patterns for file header lines (imports, comments, etc.) */
const HEADER_PATTERNS = [
	/^import\s/, // ES6 imports
	/^from\s.*import/, // Python imports
	/^const\s.*=\s*require/, // CommonJS requires
	/^#!/, // Shebang
	/^\/\*/, // Block comment start
	/^\*/, // Block comment continuation
	/^\s*\*\//, // Block comment end
	/^\/\//, // Line comment
	/^#(?!include)/, // Python/shell comment (not C #include)
	/^"""/, // Python docstring
	/^'''/, // Python docstring
	/^use\s/, // Rust use
	/^package\s/, // Go/Java package
	/^require\s/, // Lua require
	/^@/, // Decorators (Python, TypeScript)
	/^"use\s/, // "use strict", "use client"
]

/** Comment prefixes for header detection (Codex standard) */
const COMMENT_PREFIXES = ["#", "//", "--", "/*", "*", "'''", '"""']

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Parse a file's lines into LineRecord objects with indentation information.
 */
export function parseLines(content: string): LineRecord[] {
	const lines = content.split("\n")
	return lines.map((line, index) => {
		const trimmed = line.trimStart()
		const leadingWhitespace = line.length - trimmed.length

		// Calculate indent in spaces (tabs = TAB_WIDTH spaces each)
		let indentSpaces = 0
		for (let i = 0; i < leadingWhitespace; i++) {
			if (line[i] === "\t") {
				indentSpaces += TAB_WIDTH
			} else {
				indentSpaces += 1
			}
		}
		// Convert to indent level (number of INDENT_SIZE units)
		const indentLevel = Math.floor(indentSpaces / INDENT_SIZE)

		const isBlank = trimmed.length === 0
		const isBlockStart = !isBlank && BLOCK_START_PATTERNS.some((pattern) => pattern.test(line))

		return {
			lineNumber: index + 1,
			content: line,
			indentLevel,
			isBlank,
			isBlockStart,
		}
	})
}

/**
 * Compute effective indents where blank lines inherit the previous non-blank line's indent.
 * This matches the Codex algorithm behavior.
 */
export function computeEffectiveIndents(lines: LineRecord[]): number[] {
	const effective: number[] = []
	let previousIndent = 0

	for (const line of lines) {
		if (line.isBlank) {
			effective.push(previousIndent)
		} else {
			previousIndent = line.indentLevel
			effective.push(previousIndent)
		}
	}
	return effective
}

/**
 * Check if a line is a comment (for include_header behavior).
 */
function isComment(line: LineRecord): boolean {
	const trimmed = line.content.trim()
	return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

/**
 * Trim empty lines from the front and back of a line array.
 */
function trimEmptyLines(lines: LineRecord[]): void {
	// Trim from front
	while (lines.length > 0 && lines[0].isBlank) {
		lines.shift()
	}
	// Trim from back
	while (lines.length > 0 && lines[lines.length - 1].isBlank) {
		lines.pop()
	}
}

/**
 * Find the file header (imports, top-level comments, etc.).
 * Returns the end index of the header section.
 */
function findHeaderEnd(lines: LineRecord[]): number {
	let lastHeaderIdx = -1
	let inBlockComment = false

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.content.trim()

		// Track block comments
		if (trimmed.startsWith("/*")) inBlockComment = true
		if (trimmed.endsWith("*/")) {
			inBlockComment = false
			lastHeaderIdx = i
			continue
		}
		if (inBlockComment) {
			lastHeaderIdx = i
			continue
		}

		// Check if this is a header line
		if (line.isBlank) {
			// Blank lines are part of header if we haven't seen content yet
			if (lastHeaderIdx === i - 1) {
				lastHeaderIdx = i
			}
			continue
		}

		const isHeader = HEADER_PATTERNS.some((pattern) => pattern.test(trimmed))
		if (isHeader) {
			lastHeaderIdx = i
		} else if (line.indentLevel === 0) {
			// Hit first non-header top-level content
			break
		}
	}

	return lastHeaderIdx
}

/**
 * Format lines with line numbers, applying truncation to long lines.
 */
export function formatWithLineNumbers(lines: LineRecord[], maxLineLength: number = MAX_LINE_LENGTH): string {
	if (lines.length === 0) return ""
	const maxLineNumWidth = String(lines[lines.length - 1]?.lineNumber || 1).length

	return lines
		.map((line) => {
			const lineNum = String(line.lineNumber).padStart(maxLineNumWidth, " ")
			let content = line.content

			// Truncate long lines
			if (content.length > maxLineLength) {
				content = content.substring(0, maxLineLength - 3) + "..."
			}

			return `${lineNum} | ${content}`
		})
		.join("\n")
}

/**
 * Convert a contiguous array of LineRecords into merged ranges for output.
 */
function computeIncludedRanges(lines: LineRecord[]): Array<[number, number]> {
	if (lines.length === 0) return []

	const ranges: Array<[number, number]> = []
	let rangeStart = lines[0].lineNumber
	let rangeEnd = lines[0].lineNumber

	for (let i = 1; i < lines.length; i++) {
		const lineNum = lines[i].lineNumber
		if (lineNum === rangeEnd + 1) {
			// Contiguous
			rangeEnd = lineNum
		} else {
			// Gap - save current range and start new one
			ranges.push([rangeStart, rangeEnd])
			rangeStart = lineNum
			rangeEnd = lineNum
		}
	}
	// Don't forget the last range
	ranges.push([rangeStart, rangeEnd])

	return ranges
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Read a file using indentation-based semantic extraction (Codex algorithm).
 *
 * Uses bidirectional expansion from the anchor line with sibling exclusion counters.
 *
 * @param content - The file content to process
 * @param options - Extraction options
 * @returns The extracted content with metadata
 */
export function readWithIndentation(content: string, options: IndentationReadOptions): IndentationReadResult {
	const {
		anchorLine,
		maxLevels = DEFAULT_MAX_LEVELS,
		includeSiblings = false,
		includeHeader = true,
		limit = DEFAULT_LINE_LIMIT,
		maxLines,
	} = options

	const lines = parseLines(content)
	const totalLines = lines.length

	// Validate anchor line
	if (anchorLine < 1 || anchorLine > totalLines) {
		return {
			content: `Error: anchor_line ${anchorLine} is out of range (1-${totalLines})`,
			includedRanges: [],
			totalLines,
			returnedLines: 0,
			wasTruncated: false,
		}
	}

	const anchorIdx = anchorLine - 1 // Convert to 0-based
	const effectiveIndents = computeEffectiveIndents(lines)
	const anchorIndent = effectiveIndents[anchorIdx]

	// Calculate minimum indent threshold
	// maxLevels = 0 means unlimited (minIndent = 0)
	// maxLevels > 0 means limit to that many levels above anchor
	let minIndent: number
	if (maxLevels === 0) {
		minIndent = 0
	} else {
		// Each "level" is INDENT_SIZE spaces worth of indentation
		// We subtract maxLevels from the anchor's indent level
		minIndent = Math.max(0, anchorIndent - maxLevels)
	}

	// Calculate final limit (use maxLines as hard cap if provided)
	const guardLimit = maxLines ?? limit
	const finalLimit = Math.min(limit, guardLimit, totalLines)

	// Edge case: if limit is 1, just return the anchor line
	if (finalLimit === 1) {
		const singleLine = [lines[anchorIdx]]
		return {
			content: formatWithLineNumbers(singleLine),
			includedRanges: [[anchorLine, anchorLine]],
			totalLines,
			returnedLines: 1,
			wasTruncated: totalLines > 1,
		}
	}

	// Bidirectional expansion from anchor (Codex algorithm)
	const result: LineRecord[] = [lines[anchorIdx]]
	let i = anchorIdx - 1 // Up cursor
	let j = anchorIdx + 1 // Down cursor
	let iMinCount = 0 // Count of min-indent lines seen going up
	let jMinCount = 0 // Count of min-indent lines seen going down

	while (result.length < finalLimit) {
		let progressed = false

		// Expand upward
		if (i >= 0 && effectiveIndents[i] >= minIndent) {
			result.unshift(lines[i])
			progressed = true

			// Handle sibling exclusion at min indent
			if (effectiveIndents[i] === minIndent && !includeSiblings) {
				const allowHeader = includeHeader && isComment(lines[i])
				const canTake = allowHeader || iMinCount === 0

				if (canTake) {
					iMinCount++
				} else {
					// Reject this line - remove it and stop expanding up
					result.shift()
					progressed = false
					i = -1 // Stop expanding up
				}
			}

			if (i >= 0) i--
		} else if (i >= 0) {
			i = -1 // Stop expanding up (hit lower indent)
		}

		if (result.length >= finalLimit) break

		// Expand downward
		if (j < lines.length && effectiveIndents[j] >= minIndent) {
			result.push(lines[j])
			progressed = true

			// Handle sibling exclusion at min indent
			if (effectiveIndents[j] === minIndent && !includeSiblings) {
				if (jMinCount > 0) {
					// Already saw one min-indent block going down, reject this
					result.pop()
					progressed = false
					j = lines.length // Stop expanding down
				}
				jMinCount++
			}

			if (j < lines.length) j++
		} else if (j < lines.length) {
			j = lines.length // Stop expanding down (hit lower indent)
		}

		if (!progressed) break
	}

	// Trim leading/trailing empty lines
	trimEmptyLines(result)

	// Check if we were truncated
	const wasTruncated = result.length >= finalLimit || i >= 0 || j < lines.length

	// Format output
	const formattedContent = formatWithLineNumbers(result)

	// Compute included ranges
	const includedRanges = computeIncludedRanges(result)

	return {
		content: formattedContent,
		includedRanges,
		totalLines,
		returnedLines: result.length,
		wasTruncated: wasTruncated && result.length < totalLines,
	}
}

/**
 * Simple slice mode reading - read lines with offset/limit.
 *
 * @param content - The file content to process
 * @param offset - 0-based line offset to start from (default: 0)
 * @param limit - Maximum lines to return (default: 2000)
 * @returns The extracted content with metadata
 */
export function readWithSlice(
	content: string,
	offset: number = 0,
	limit: number = DEFAULT_LINE_LIMIT,
): IndentationReadResult {
	const lines = parseLines(content)
	const totalLines = lines.length

	// Validate offset
	if (offset < 0) offset = 0
	if (offset >= totalLines) {
		return {
			content: `Error: offset ${offset} is beyond file end (${totalLines} lines)`,
			includedRanges: [],
			totalLines,
			returnedLines: 0,
			wasTruncated: false,
		}
	}

	// Slice lines
	const endIdx = Math.min(offset + limit, totalLines)
	const selectedLines = lines.slice(offset, endIdx)
	const wasTruncated = endIdx < totalLines

	// Format output
	const formattedContent = formatWithLineNumbers(selectedLines)

	return {
		content: formattedContent,
		includedRanges: [[offset + 1, endIdx]], // 1-based
		totalLines,
		returnedLines: selectedLines.length,
		wasTruncated,
	}
}
