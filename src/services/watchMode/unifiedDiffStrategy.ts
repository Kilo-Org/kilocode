import * as vscode from "vscode"

/**
 * Interface for a diff edit
 */
export interface DiffEdit {
	path: string
	hunk: string[]
}

/**
 * Custom error for when search text is not unique in a file
 */
export class SearchTextNotUnique extends Error {
	constructor(message: string) {
		super(message)
		this.name = "SearchTextNotUnique"
	}
}

/**
 * Error messages for diff application failures
 */
export const NO_MATCH_ERROR = `UnifiedDiffNoMatch: hunk failed to apply!

{path} does not contain lines that match the diff you provided!
Try again.
DO NOT skip blank lines, comments, docstrings, etc!
The diff needs to apply cleanly to the lines in {path}!

{path} does not contain these {num_lines} exact lines in a row:
\`\`\`
{original}\`\`\`
`

export const NOT_UNIQUE_ERROR = `UnifiedDiffNotUnique: hunk failed to apply!

{path} contains multiple sets of lines that match the diff you provided!
Try again.
Use additional \` \` lines to provide context that uniquely indicates which code needs to be changed.
The diff needs to apply to a unique set of lines in {path}!

{path} contains multiple copies of these {num_lines} lines:
\`\`\`
{original}\`\`\`
`

export const OTHER_HUNKS_APPLIED =
	"Note: some hunks did apply successfully. See the updated source code shown above.\n\n"

/**
 * Parses unified diffs from the AI response
 * @param response The AI response containing unified diffs
 * @returns An array of parsed diffs
 */
export function findDiffs(content: string): DiffEdit[] {
	// Ensure content ends with newline
	if (!content.endsWith("\n")) {
		content = content + "\n"
	}

	// Split by newline but don't add extra newlines to each line
	const lines = content.split("\n")
	let lineNum = 0
	const edits: DiffEdit[] = []

	// First check for code blocks with diffs
	while (lineNum < lines.length) {
		const line = lines[lineNum]
		if (
			line.startsWith("```diff") ||
			(line.startsWith("```") &&
				lineNum + 2 < lines.length &&
				lines[lineNum + 1].startsWith("---") &&
				lines[lineNum + 2].startsWith("+++"))
		) {
			const [newLineNum, theseEdits] = processFencedBlock(lines, lineNum + 1)
			edits.push(...theseEdits)
			lineNum = newLineNum
		} else {
			lineNum++
		}
	}

	// If no code blocks found, check for raw diffs in the content
	if (edits.length === 0 && content.includes("---") && content.includes("+++")) {
		// Try to extract diffs directly from the content
		const contentLines = content.split("\n")
		let diffContent = ""
		let inDiff = false

		for (const line of contentLines) {
			if (line.startsWith("---")) {
				inDiff = true
				diffContent = line + "\n"
			} else if (inDiff) {
				diffContent += line + "\n"
				if (line.trim() === "" && diffContent.includes("+++") && diffContent.includes("@@")) {
					// Process this diff block
					const dummyLines = diffContent.split("\n")
					const [_, theseEdits] = processDiffBlock(dummyLines, 0)
					edits.push(...theseEdits)
					inDiff = false
					diffContent = ""
				}
			}
		}

		// Add the last diff if there is one
		if (inDiff && diffContent.includes("+++") && diffContent.includes("@@")) {
			const dummyLines = diffContent.split("\n")
			const [_, theseEdits] = processDiffBlock(dummyLines, 0)
			edits.push(...theseEdits)
		}
	}

	return edits
}

/**
 * Processes a fenced code block to extract diffs
 */
export function processFencedBlock(lines: string[], startLineNum: number): [number, DiffEdit[]] {
	let lineNum = startLineNum
	// Find the end of the code block
	for (; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum]
		if (line.startsWith("```")) {
			break
		}
	}

	// Extract the content inside the code block
	const block = lines.slice(startLineNum, lineNum)

	// Process the block content
	const [_, edits] = processDiffBlock(block, 0)

	// Return the updated line number and edits
	return [lineNum + 1, edits]
}

/**
 * Processes a block of diff content
 */
export function processDiffBlock(lines: string[], startLineNum: number): [number, DiffEdit[]] {
	// Add a dummy @@ line at the end if needed for processing
	if (!lines[lines.length - 1]?.startsWith("@@")) {
		lines.push("@@ @@\n")
	}

	let lineNum = startLineNum
	let fname: string | null = null
	const edits: DiffEdit[] = []

	// Find the file path
	if (lines[0]?.startsWith("--- ") && lines[1]?.startsWith("+++ ")) {
		// Extract the file path, considering that it might contain spaces
		const aFname = lines[0].substring(4).trim()
		const bFname = lines[1].substring(4).trim()

		// Check if standard git diff prefixes are present (or /dev/null) and strip them
		if ((aFname.startsWith("a/") || aFname === "/dev/null") && bFname.startsWith("b/")) {
			fname = bFname.substring(2)
		} else {
			// Otherwise, assume the path is as intended
			fname = bFname
		}

		// Check for generic filenames
		const genericFileNames = ["Code", "code", "file", "File", "test", "Test"]
		if (fname && genericFileNames.includes(fname)) {
			console.log(`[WatchMode DEBUG] Warning: Generic filename "${fname}" detected in unified diff`)
			// We'll handle this later when converting to NewDiffEdit format
		}

		// Skip the header lines
		lineNum += 2
	}

	let keeper = false
	let hunk: string[] = []
	let op = " "

	// Process each line in the diff
	for (; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum]
		hunk.push(line)

		if (line.length < 2) {
			continue
		}

		// Handle new file header
		if (line.startsWith("+++ ") && hunk.length >= 2 && hunk[hunk.length - 2]?.startsWith("--- ")) {
			// Remove the previous file header from the current hunk
			if (hunk.length >= 3 && hunk[hunk.length - 3] === "\n") {
				hunk = hunk.slice(0, -3)
			} else {
				hunk = hunk.slice(0, -2)
			}

			// Save the current hunk if we have a valid file name
			if (fname !== null && hunk.length > 0) {
				edits.push({ path: fname, hunk })
			}

			// Reset for the new file
			hunk = []
			keeper = false
			fname = line.substring(4).trim()
			continue
		}

		// Check for content lines
		op = line[0]
		if (op === "-" || op === "+") {
			keeper = true
			continue
		}

		// Check for hunk header
		if (op !== "@") {
			continue
		}

		// If we don't have any content to keep, skip this hunk
		if (!keeper) {
			hunk = []
			continue
		}

		// Remove the hunk header from the content
		hunk.pop()

		// Save the hunk if we have a valid file name
		if (fname !== null && hunk.length > 0) {
			edits.push({ path: fname, hunk })
		}

		// Reset for the next hunk
		hunk = []
		keeper = false
	}

	return [lineNum, edits]
}

/**
 * Helper function to normalize whitespace
 */
function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

/**
 * Helper function to escape special characters in a string for use in a regular expression
 */
function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Converts a hunk to before and after text
 */
export function hunkToBeforeAfter(hunk: string[], asLines = false): [string[] | string, string[] | string] {
	const before: string[] = []
	const after: string[] = []

	for (const line of hunk) {
		if (!line || line.length === 0) {
			// Empty line, treat as unchanged
			before.push("")
			after.push("")
			continue
		}

		// Special case: a line that's just "-" or "+" represents an empty line being removed or added
		if (line === "-") {
			before.push("")
			continue
		}
		if (line === "+") {
			after.push("")
			continue
		}

		if (line.length < 2) {
			// Very short line that's not a diff marker, treat as unchanged
			before.push(line)
			after.push(line)
			continue
		}

		const op = line[0]
		const content = line.substring(1)

		if (op === " ") {
			before.push(content)
			after.push(content)
		} else if (op === "-") {
			before.push(content)
		} else if (op === "+") {
			after.push(content)
		}
	}

	if (asLines) {
		return [before, after]
	}

	// Join with newlines to ensure proper line separation
	return [before.join("\n"), after.join("\n")]
}

/**
 * Cleans up pure whitespace lines
 */
function cleanupPureWhitespaceLines(lines: string[]): string[] {
	return lines.map((line) => {
		if (line.trim() === "") {
			// Keep only the line ending
			const match = line.match(/[\r\n]+$/)
			return match ? match[0] : line
		}
		return line
	})
}

/**
 * Normalizes a hunk
 */
export function normalizeHunk(hunk: string[]): string[] {
	const [before, after] = hunkToBeforeAfter(hunk, true) as [string[], string[]]

	const cleanBefore = cleanupPureWhitespaceLines(before)
	const cleanAfter = cleanupPureWhitespaceLines(after)

	// Create a new diff
	const result: string[] = []

	// Add context lines
	let beforeIndex = 0
	let afterIndex = 0

	while (beforeIndex < cleanBefore.length || afterIndex < cleanAfter.length) {
		if (
			beforeIndex < cleanBefore.length &&
			afterIndex < cleanAfter.length &&
			cleanBefore[beforeIndex] === cleanAfter[afterIndex]
		) {
			// Unchanged line
			result.push(" " + cleanBefore[beforeIndex])
			beforeIndex++
			afterIndex++
		} else if (beforeIndex < cleanBefore.length) {
			// Removed line
			result.push("-" + cleanBefore[beforeIndex])
			beforeIndex++
		} else if (afterIndex < cleanAfter.length) {
			// Added line
			result.push("+" + cleanAfter[afterIndex])
			afterIndex++
		}
	}

	return result
}

/**
 * Flexible search and replace
 */
export function flexiSearchAndReplace(before: string, after: string, content: string): string | null {
	// Simple case: direct replacement
	if (content.includes(before)) {
		// Check if the search text appears multiple times
		const regex = new RegExp(escapeRegExp(before), "g")
		const matches = content.match(regex)
		if (matches && matches.length > 1) {
			throw new SearchTextNotUnique(`Search text appears ${matches.length} times in the content`)
		}

		return content.replace(before, after)
	}

	// Try with normalized whitespace
	const normalizedBefore = normalizeWhitespace(before)
	const normalizedContent = normalizeWhitespace(content)

	if (normalizedContent.includes(normalizedBefore)) {
		// Find the position in normalized content
		const startPos = normalizedContent.indexOf(normalizedBefore)
		const endPos = startPos + normalizedBefore.length

		// Map back to original content
		let originalStartPos = 0
		let originalEndPos = 0
		let normalizedPos = 0

		for (let i = 0; i < content.length; i++) {
			if (content[i].trim() !== "") {
				if (normalizedPos === startPos) {
					originalStartPos = i
				}
				if (normalizedPos === endPos) {
					originalEndPos = i
					break
				}
				normalizedPos++
			}
		}

		// Replace in original content
		return content.substring(0, originalStartPos) + after + content.substring(originalEndPos)
	}

	// Try with case-insensitive search
	const lowerBefore = before.toLowerCase()
	const lowerContent = content.toLowerCase()

	if (lowerContent.includes(lowerBefore)) {
		const startPos = lowerContent.indexOf(lowerBefore)
		const originalBefore = content.substring(startPos, startPos + before.length)

		// Check if the search text appears multiple times
		const regex = new RegExp(escapeRegExp(originalBefore), "gi")
		const matches = content.match(regex)
		if (matches && matches.length > 1) {
			throw new SearchTextNotUnique(
				`Search text appears ${matches.length} times in the content (case-insensitive)`,
			)
		}

		return content.replace(originalBefore, after)
	}

	return null
}

/**
 * Applies a hunk to content
 */
export function applyHunk(content: string, hunk: string[]): string | null {
	// Try direct application first
	try {
		const [_beforeText, _afterText] = hunkToBeforeAfter(hunk)
		const result = directlyApplyHunk(content, hunk)
		if (result) {
			return result
		}
	} catch (error) {
		if (!(error instanceof SearchTextNotUnique)) {
			throw error
		}
		// Continue with other methods if the search text is not unique
	}

	// If direct application fails, try more advanced techniques
	try {
		// Try with different amounts of context
		return applyWithPartialContext(content, hunk)
	} catch (error) {
		console.error("[WatchMode DEBUG] Error in applyHunk:", error)
		return null
	}
}

/**
 * Directly applies a hunk to content
 */
export function directlyApplyHunk(content: string, hunk: string[]): string | null {
	const [before, after] = hunkToBeforeAfter(hunk)

	if (!before || (before as string).length === 0) {
		return content + (after as string)
	}

	const [beforeLines] = hunkToBeforeAfter(hunk, true) as [string[], string[]]
	const beforeLinesStripped = beforeLines.map((line) => line.trim()).join("")

	// Refuse to do a repeated search and replace on a tiny bit of non-whitespace context
	if (
		beforeLinesStripped.length < 10 &&
		content.includes(before as string) &&
		(content.match(new RegExp(escapeRegExp(before as string), "g")) || []).length > 1
	) {
		throw new SearchTextNotUnique("Search text too short and appears multiple times")
	}

	const result = flexiSearchAndReplace(before as string, after as string, content)

	return result
}

/**
 * Applies a hunk with partial context
 */
export function applyWithPartialContext(content: string, hunk: string[]): string | null {
	// Split the hunk into sections based on operation type
	const sections: string[][] = []
	let currentSection: string[] = []
	let currentOp = hunk[0]?.[0] || " "

	for (const line of hunk) {
		const op = line[0] || " "
		if (op !== currentOp) {
			if (currentSection.length > 0) {
				sections.push(currentSection)
			}
			currentSection = []
			currentOp = op
		}
		currentSection.push(line)
	}

	if (currentSection.length > 0) {
		sections.push(currentSection)
	}

	// If we don't have at least context-change-context pattern, return null
	if (sections.length < 3) {
		return null
	}

	// Try different combinations of context
	let updatedContent = content
	let success = false

	for (let i = 1; i < sections.length; i += 2) {
		// This is a change section (+ or - lines)
		const beforeContext = i > 0 ? sections[i - 1] : []
		const changeSection = sections[i]
		const afterContext = i < sections.length - 1 ? sections[i + 1] : []

		// Try different amounts of context
		for (let beforeAmount = beforeContext.length; beforeAmount >= 0; beforeAmount--) {
			for (let afterAmount = afterContext.length; afterAmount >= 0; afterAmount--) {
				if (beforeAmount === 0 && afterAmount === 0) {
					continue // Need at least some context
				}

				const beforeSlice = beforeAmount > 0 ? beforeContext.slice(-beforeAmount) : []
				const afterSlice = afterAmount > 0 ? afterContext.slice(0, afterAmount) : []

				const testHunk = [...beforeSlice, ...changeSection, ...afterSlice]

				try {
					const result = directlyApplyHunk(updatedContent, testHunk)
					if (result) {
						updatedContent = result
						success = true
						break
					}
				} catch (error) {
					// Ignore and try the next combination
				}
			}

			if (success) break
		}

		if (!success) {
			return null // Couldn't apply this change section
		}

		// Reset for the next change section
		success = false
	}

	return updatedContent
}

/**
 * Main class for handling unified diffs
 */
export class UnifiedDiffHandler {
	/**
	 * Gets edits from a response
	 */
	public getEdits(response: string): DiffEdit[] {
		return findDiffs(response)
	}

	/**
	 * Applies edits to content
	 */
	public applyEdits(edits: DiffEdit[], documentContent: string, documentUri: vscode.Uri): [string, string[]] {
		const seen = new Set<string>()
		const uniq: DiffEdit[] = []
		const errors: string[] = []
		let newContent = documentContent
		const documentPath = vscode.workspace.asRelativePath(documentUri)

		// Deduplicate edits
		for (const { path: editPath, hunk } of edits) {
			const normalizedHunk = normalizeHunk(hunk)
			if (normalizedHunk.length === 0) {
				continue
			}

			// Handle special cases like "untitled" which should use the current document path
			let finalPath = editPath
			if (finalPath === "untitled" || finalPath === "/dev/null") {
				finalPath = documentPath
				console.log(
					`[WatchMode DEBUG] Replacing placeholder filename with current document path: ${documentPath}`,
				)
			}

			const key = finalPath + "\n" + normalizedHunk.join("")
			if (seen.has(key)) {
				continue
			}
			seen.add(key)

			uniq.push({ path: finalPath, hunk: normalizedHunk })
		}

		console.log(`[WatchMode DEBUG] Processing ${uniq.length} unique edits`)

		// Apply each edit
		for (const { path: _editPath, hunk } of uniq) {
			const [original] = hunkToBeforeAfter(hunk)
			const relPath = vscode.workspace.asRelativePath(documentUri)

			console.log(`[WatchMode DEBUG] Applying hunk to ${relPath}`)

			try {
				const updatedContent = applyHunk(newContent, hunk)
				if (!updatedContent) {
					const errorMsg = NO_MATCH_ERROR.replace(/{path}/g, relPath)
						.replace(/{original}/g, original as string)
						.replace(/{num_lines}/g, (original as string).split("\n").length.toString())

					console.error(`[WatchMode DEBUG] Hunk failed to apply: ${errorMsg.split("\n")[0]}`)
					errors.push(errorMsg)
					continue
				}

				// Update the content for subsequent edits
				newContent = updatedContent
				console.log(`[WatchMode DEBUG] Successfully applied hunk to ${relPath}`)
			} catch (error) {
				if (error instanceof SearchTextNotUnique) {
					const errorMsg = NOT_UNIQUE_ERROR.replace(/{path}/g, relPath)
						.replace(/{original}/g, original as string)
						.replace(/{num_lines}/g, (original as string).split("\n").length.toString())

					console.error(`[WatchMode DEBUG] Search text not unique: ${errorMsg.split("\n")[0]}`)
					errors.push(errorMsg)
				} else {
					console.error(`[WatchMode DEBUG] Error applying diff: ${error.message}`)
					errors.push(`Error applying diff to ${relPath}: ${error.message}`)
				}
				continue
			}
		}

		if (errors.length > 0 && errors.length < uniq.length) {
			errors.push(OTHER_HUNKS_APPLIED)
		}

		return [newContent, errors]
	}
}

/**
 * For compatibility with the previous API, converts from legacy format to new format
 */
export const parseDiffs = (
	response: string,
): Array<{
	originalFile: string
	newFile: string
	hunks: Array<{
		content: string
	}>
}> => {
	const edits = findDiffs(response)

	// Convert to legacy format
	return edits.map((edit) => {
		// Extract file paths from the edit
		let originalFile = edit.path
		let newFile = edit.path

		// Find hunks based on @@ markers
		const hunksText = edit.hunk.join("")
		const hunkMatches = hunksText.split(/(?=@@)/g)
		const hunks = hunkMatches
			.filter((h) => h.trim().startsWith("@@"))
			.map((h) => ({
				content: h.trim(),
			}))

		// If no hunks with @@ markers, create a single hunk
		if (hunks.length === 0) {
			hunks.push({
				content: "@@ @@ \n" + edit.hunk.join(""),
			})
		}

		return {
			originalFile,
			newFile,
			hunks,
		}
	})
}

/**
 * Applies a unified diff to a document
 * @param document The document to modify
 * @param diff The unified diff to apply
 * @returns A promise that resolves to true if the diff was applied successfully
 */
export const applyDiffToDocument = async (
	document: vscode.TextDocument,
	diff: {
		originalFile: string
		newFile: string
		hunks: Array<{
			content: string
		}>
	},
): Promise<boolean> => {
	try {
		// Convert from legacy format to new format
		const edits: DiffEdit[] = diff.hunks.map((hunk) => ({
			path: diff.newFile,
			hunk: hunk.content.split("\n"),
		}))

		// Create a new diff handler
		const diffHandler = new UnifiedDiffHandler()

		// Apply the edits
		const [newContent, errors] = diffHandler.applyEdits(edits, document.getText(), document.uri)

		if (errors.length > 0) {
			console.log(`[WatchMode DEBUG] Errors applying diff: ${errors.length}`)
			for (const error of errors) {
				console.error(`[WatchMode DEBUG] ${error.split("\n")[0]}`)
			}

			// Only return false if all edits failed
			if (errors.length >= edits.length) {
				return false
			}
		}

		// Apply the changes to the document
		const edit = new vscode.WorkspaceEdit()
		const fullRange = new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length))

		edit.replace(document.uri, fullRange, newContent)
		const result = await vscode.workspace.applyEdit(edit)

		return result
	} catch (error) {
		console.error("[WatchMode DEBUG] Error applying diff:", error)
		return false
	}
}
