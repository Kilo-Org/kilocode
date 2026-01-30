/**
 * Core patch application logic for the apply_patch tool.
 * Transforms file contents using parsed hunks.
 */

import type { Hunk, UpdateFileChunk } from "./parser"
import { seekSequence } from "./seek-sequence"

/**
 * Error during patch application.
 */
export class ApplyPatchError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ApplyPatchError"
	}
}

/**
 * Result of applying a patch to a file.
 */
export interface ApplyPatchFileChange {
	type: "add" | "delete" | "update"
	/** Original path of the file */
	path: string
	/** New path if the file was moved/renamed */
	movePath?: string
	/** Original content (for delete/update) */
	originalContent?: string
	/** New content (for add/update) */
	newContent?: string
}

/**
 * Compute the replacements needed to transform originalLines into the new lines.
 * Each replacement is [startIndex, oldLength, newLines].
 */
function computeReplacements(
	originalLines: string[],
	filePath: string,
	chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
	const replacements: Array<[number, number, string[]]> = []
	let lineIndex = 0

	for (const chunk of chunks) {
		// If a chunk has a change_context, find it first
		if (chunk.changeContext !== null) {
			const idx = seekSequence(originalLines, [chunk.changeContext], lineIndex, false)
			if (idx === null) {
				throw new ApplyPatchError(`Failed to find context '${chunk.changeContext}' in ${filePath}`)
			}
			lineIndex = idx + 1
		}

		if (chunk.oldLines.length === 0) {
			// Pure addition (no old lines). Add at the end or before final empty line.
			const insertionIdx =
				originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
					? originalLines.length - 1
					: originalLines.length
			replacements.push([insertionIdx, 0, chunk.newLines])
			continue
		}

		// Try to find the old_lines in the file
		let pattern = chunk.oldLines
		let newSlice = chunk.newLines
		let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile)

		// If not found and pattern ends with empty string (trailing newline),
		// retry without it
		if (found === null && pattern.length > 0 && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1)
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1)
			}
			found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile)
		}

		if (found !== null) {
			replacements.push([found, pattern.length, newSlice])
			lineIndex = found + pattern.length
		} else {
			throw new ApplyPatchError(
				`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n").substring(0, 200)}${chunk.oldLines.join("\n").length > 200 ? "..." : ""}`,
			)
		}
	}

	// Sort replacements by start index
	replacements.sort((a, b) => a[0] - b[0])

	return replacements
}

/**
 * Apply replacements to the original lines, returning the modified content.
 * Replacements must be applied in reverse order to preserve indices.
 */
function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
	const result = [...lines]

	// Apply in reverse order so earlier replacements don't shift later indices
	for (let i = replacements.length - 1; i >= 0; i--) {
		const [startIdx, oldLen, newSegment] = replacements[i]!

		// Remove old lines
		result.splice(startIdx, oldLen, ...newSegment)
	}

	return result
}

/**
 * Apply chunks to file content, returning the new content.
 *
 * @param originalContent - The original file content
 * @param filePath - The file path (for error messages)
 * @param chunks - The update chunks to apply
 * @returns The new file content
 */
export function applyChunksToContent(originalContent: string, filePath: string, chunks: UpdateFileChunk[]): string {
	// Split content into lines
	let originalLines = originalContent.split("\n")

	// Drop trailing empty element that results from final newline
	// so that line counts match standard diff behavior
	if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
		originalLines = originalLines.slice(0, -1)
	}

	const replacements = computeReplacements(originalLines, filePath, chunks)
	let newLines = applyReplacements(originalLines, replacements)

	// Ensure file ends with newline
	if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
		newLines = [...newLines, ""]
	}

	return newLines.join("\n")
}

/**
 * Process a single hunk and return the file change.
 *
 * @param hunk - The hunk to process
 * @param readFile - Function to read file contents
 * @returns The file change result
 */
export async function processHunk(
	hunk: Hunk,
	readFile: (path: string) => Promise<string>,
): Promise<ApplyPatchFileChange> {
	switch (hunk.type) {
		case "AddFile":
			return {
				type: "add",
				path: hunk.path,
				newContent: hunk.contents,
			}

		case "DeleteFile": {
			const content = await readFile(hunk.path)
			return {
				type: "delete",
				path: hunk.path,
				originalContent: content,
			}
		}

		case "UpdateFile": {
			const originalContent = await readFile(hunk.path)
			const newContent = applyChunksToContent(originalContent, hunk.path, hunk.chunks)
			return {
				type: "update",
				path: hunk.path,
				movePath: hunk.movePath ?? undefined,
				originalContent,
				newContent,
			}
		}
	}
}

/**
 * Process all hunks in a patch.
 *
 * @param hunks - The hunks to process
 * @param readFile - Function to read file contents
 * @returns Array of file changes
 */
export async function processAllHunks(
	hunks: Hunk[],
	readFile: (path: string) => Promise<string>,
): Promise<ApplyPatchFileChange[]> {
	const changes: ApplyPatchFileChange[] = []

	for (const hunk of hunks) {
		const change = await processHunk(hunk, readFile)
		changes.push(change)
	}

	return changes
}
