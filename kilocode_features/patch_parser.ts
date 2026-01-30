/**
 * Parser for the apply_patch tool format.
 * Converts patch text into structured hunks following the Codex apply_patch specification.
 *
 * Grammar:
 * Patch := Begin { FileOp } End
 * Begin := "*** Begin Patch" NEWLINE
 * End := "*** End Patch" NEWLINE
 * FileOp := AddFile | DeleteFile | UpdateFile
 * AddFile := "*** Add File: " path NEWLINE { "+" line NEWLINE }
 * DeleteFile := "*** Delete File: " path NEWLINE
 * UpdateFile := "*** Update File: " path NEWLINE [ MoveTo ] { Hunk }
 * MoveTo := "*** Move to: " newPath NEWLINE
 * Hunk := "@@" [ header ] NEWLINE { HunkLine } [ "*** End of File" NEWLINE ]
 * HunkLine := (" " | "-" | "+") text NEWLINE
 */

const BEGIN_PATCH_MARKER = "*** Begin Patch"
const END_PATCH_MARKER = "*** End Patch"
const ADD_FILE_MARKER = "*** Add File: "
const DELETE_FILE_MARKER = "*** Delete File: "
const UPDATE_FILE_MARKER = "*** Update File: "
const MOVE_TO_MARKER = "*** Move to: "
const EOF_MARKER = "*** End of File"
const CHANGE_CONTEXT_MARKER = "@@ "
const EMPTY_CHANGE_CONTEXT_MARKER = "@@"

/**
 * Represents an error during patch parsing.
 */
export class ParseError extends Error {
	constructor(
		message: string,
		public lineNumber?: number,
	) {
		super(lineNumber !== undefined ? `Line ${lineNumber}: ${message}` : message)
		this.name = "ParseError"
	}
}

/**
 * A chunk within an UpdateFile hunk.
 */
export interface UpdateFileChunk {
	/** Optional context line (e.g., class or function name) to narrow search */
	changeContext: string | null
	/** Lines to find and replace (context + removed lines) */
	oldLines: string[]
	/** Lines to replace with (context + added lines) */
	newLines: string[]
	/** If true, old_lines must match at end of file */
	isEndOfFile: boolean
}

/**
 * Represents a file operation in a patch.
 */
export type Hunk =
	| {
			type: "AddFile"
			path: string
			contents: string
	  }
	| {
			type: "DeleteFile"
			path: string
	  }
	| {
			type: "UpdateFile"
			path: string
			movePath: string | null
			chunks: UpdateFileChunk[]
	  }

/**
 * Result of parsing a patch.
 */
export interface ApplyPatchArgs {
	hunks: Hunk[]
	patch: string
}

/**
 * Check if lines start and end with correct patch markers.
 */
function checkPatchBoundaries(lines: string[]): void {
	if (lines.length === 0) {
		throw new ParseError("Empty patch")
	}

	const firstLine = lines[0]?.trim()
	const lastLine = lines[lines.length - 1]?.trim()

	if (firstLine !== BEGIN_PATCH_MARKER) {
		throw new ParseError("The first line of the patch must be '*** Begin Patch'")
	}

	if (lastLine !== END_PATCH_MARKER) {
		throw new ParseError("The last line of the patch must be '*** End Patch'")
	}
}

/**
 * Parse a single UpdateFileChunk from lines.
 * Returns the parsed chunk and number of lines consumed.
 */
function parseUpdateFileChunk(
	lines: string[],
	lineNumber: number,
	allowMissingContext: boolean,
): { chunk: UpdateFileChunk; linesConsumed: number } {
	if (lines.length === 0) {
		throw new ParseError("Update hunk does not contain any lines", lineNumber)
	}

	let changeContext: string | null = null
	let startIndex = 0

	// Check for context marker
	if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
		changeContext = null
		startIndex = 1
	} else if (lines[0]?.startsWith(CHANGE_CONTEXT_MARKER)) {
		changeContext = lines[0].substring(CHANGE_CONTEXT_MARKER.length)
		startIndex = 1
	} else if (!allowMissingContext) {
		throw new ParseError(`Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`, lineNumber)
	}

	if (startIndex >= lines.length) {
		throw new ParseError("Update hunk does not contain any lines", lineNumber + 1)
	}

	const chunk: UpdateFileChunk = {
		changeContext,
		oldLines: [],
		newLines: [],
		isEndOfFile: false,
	}

	let parsedLines = 0
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i]

		if (line === EOF_MARKER) {
			if (parsedLines === 0) {
				throw new ParseError("Update hunk does not contain any lines", lineNumber + 1)
			}
			chunk.isEndOfFile = true
			parsedLines++
			break
		}

		const firstChar = line.charAt(0)

		// Empty line is treated as context
		if (line === "") {
			chunk.oldLines.push("")
			chunk.newLines.push("")
			parsedLines++
			continue
		}

		switch (firstChar) {
			case " ":
				// Context line
				chunk.oldLines.push(line.substring(1))
				chunk.newLines.push(line.substring(1))
				parsedLines++
				break
			case "+":
				// Added line
				chunk.newLines.push(line.substring(1))
				parsedLines++
				break
			case "-":
				// Removed line
				chunk.oldLines.push(line.substring(1))
				parsedLines++
				break
			default:
				// If we haven't parsed any lines yet, it's an error
				if (parsedLines === 0) {
					throw new ParseError(
						`Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
						lineNumber + 1,
					)
				}
				// Otherwise, assume this is the start of the next hunk
				return { chunk, linesConsumed: parsedLines + startIndex }
		}
	}

	return { chunk, linesConsumed: parsedLines + startIndex }
}

/**
 * Parse a single hunk (file operation) from lines.
 * Returns the parsed hunk and number of lines consumed.
 */
function parseOneHunk(lines: string[], lineNumber: number): { hunk: Hunk; linesConsumed: number } {
	const firstLine = lines[0]?.trim()

	// Add File
	if (firstLine?.startsWith(ADD_FILE_MARKER)) {
		const path = firstLine.substring(ADD_FILE_MARKER.length)
		let contents = ""
		let parsedLines = 1

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i]
			if (line?.startsWith("+")) {
				contents += line.substring(1) + "\n"
				parsedLines++
			} else {
				break
			}
		}

		return {
			hunk: { type: "AddFile", path, contents },
			linesConsumed: parsedLines,
		}
	}

	// Delete File
	if (firstLine?.startsWith(DELETE_FILE_MARKER)) {
		const path = firstLine.substring(DELETE_FILE_MARKER.length)
		return {
			hunk: { type: "DeleteFile", path },
			linesConsumed: 1,
		}
	}

	// Update File
	if (firstLine?.startsWith(UPDATE_FILE_MARKER)) {
		const path = firstLine.substring(UPDATE_FILE_MARKER.length)
		let remainingLines = lines.slice(1)
		let parsedLines = 1

		// Check for optional Move to line
		let movePath: string | null = null
		if (remainingLines[0]?.startsWith(MOVE_TO_MARKER)) {
			movePath = remainingLines[0].substring(MOVE_TO_MARKER.length)
			remainingLines = remainingLines.slice(1)
			parsedLines++
		}

		const chunks: UpdateFileChunk[] = []

		while (remainingLines.length > 0) {
			// Skip blank lines between chunks
			if (remainingLines[0]?.trim() === "") {
				parsedLines++
				remainingLines = remainingLines.slice(1)
				continue
			}

			// Stop if we hit another file operation marker
			if (remainingLines[0]?.startsWith("***")) {
				break
			}

			const { chunk, linesConsumed } = parseUpdateFileChunk(
				remainingLines,
				lineNumber + parsedLines,
				chunks.length === 0, // Allow missing context for first chunk
			)
			chunks.push(chunk)
			parsedLines += linesConsumed
			remainingLines = remainingLines.slice(linesConsumed)
		}

		if (chunks.length === 0) {
			throw new ParseError(`Update file hunk for path '${path}' is empty`, lineNumber)
		}

		return {
			hunk: { type: "UpdateFile", path, movePath, chunks },
			linesConsumed: parsedLines,
		}
	}

	throw new ParseError(
		`'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
		lineNumber,
	)
}

/**
 * Parse a patch string into structured hunks.
 *
 * @param patch - The patch text to parse
 * @returns Parsed patch with hunks
 * @throws ParseError if the patch is invalid
 */
export function parsePatch(patch: string): ApplyPatchArgs {
	const trimmedPatch = patch.trim()
	const lines = trimmedPatch.split("\n")

	// Handle heredoc-wrapped patches (lenient mode)
	let effectiveLines = lines
	if (lines.length >= 4) {
		const firstLine = lines[0]
		const lastLine = lines[lines.length - 1]
		if (
			(firstLine === "<<EOF" || firstLine === "<<'EOF'" || firstLine === '<<"EOF"') &&
			lastLine?.endsWith("EOF")
		) {
			effectiveLines = lines.slice(1, lines.length - 1)
		}
	}

	checkPatchBoundaries(effectiveLines)

	const hunks: Hunk[] = []
	const lastLineIndex = effectiveLines.length - 1
	let remainingLines = effectiveLines.slice(1, lastLineIndex) // Skip Begin and End markers
	let lineNumber = 2 // Start at line 2 (after Begin Patch)

	while (remainingLines.length > 0) {
		const { hunk, linesConsumed } = parseOneHunk(remainingLines, lineNumber)
		hunks.push(hunk)
		lineNumber += linesConsumed
		remainingLines = remainingLines.slice(linesConsumed)
	}

	return {
		hunks,
		patch: effectiveLines.join("\n"),
	}
}
