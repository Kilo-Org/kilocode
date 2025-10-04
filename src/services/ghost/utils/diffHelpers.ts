import { DiffLine, myersDiff } from "./myers"

export interface DiffGroup {
	startLine: number
	endLine: number
	lines: DiffLine[]
	type?: string
}

/**
 * Given a diff of two editable regions, get the offset position at the last new line inside the editable region.
 * Ported from Continue's diff/diff.ts
 */
export function getOffsetPositionAtLastNewLine(
	diffLines: DiffLine[],
	lineContentAtCursorPos: string,
	lineOffsetAtCursorPos: number,
): {
	line: number
	character: number
} {
	let lastNewLineContent = ""
	let lineOffset = -1
	let currentResultLine = 0
	let hasChanges = false

	// Build the string while tracking line numbers in the result
	diffLines.reduce((acc, curr, i) => {
		// Add the current line to our result
		acc += curr.line

		// Add newline if not the last line
		if (i < diffLines.length - 1) {
			acc += "\n"
		}

		// If this is a "new" or "same" line, it will be part of the result
		if (curr.type === "new" || curr.type === "same") {
			if (curr.type === "new") {
				// If it's a new line, update our tracking
				lastNewLineContent = curr.line
				lineOffset = currentResultLine
				hasChanges = true
			}
			// Increment our position in the result
			currentResultLine++
		}

		return acc
	}, "")

	// If nothing has changed, return the original position
	if (!hasChanges) {
		lineOffset = lineOffsetAtCursorPos
		lastNewLineContent = lineContentAtCursorPos
	}

	// Calculate the character position for the end of the last relevant line
	const endOfCharPos = lastNewLineContent.length
	return {
		line: lineOffset,
		character: endOfCharPos,
	}
}

/**
 * Calculate the final cursor position after applying edits.
 * Ported from Continue's diff/diff.ts
 */
export function calculateFinalCursorPosition(
	currCursorPos: { line: number; character: number },
	editableRegionStartLine: number,
	oldEditRangeSlice: string,
	newEditRangeSlice: string,
): { line: number; character: number } {
	if (newEditRangeSlice === "") {
		return currCursorPos
	}

	// How far away is the current line from the start of the editable region?
	const lineOffsetAtCursorPos = currCursorPos.line - editableRegionStartLine

	// How long is the line at the current cursor position?
	const lineContentAtCursorPos = newEditRangeSlice.split("\n")[lineOffsetAtCursorPos]

	// Use myers diff from our existing implementation
	const diffLines = myersDiff(oldEditRangeSlice, newEditRangeSlice)

	const offset = getOffsetPositionAtLastNewLine(diffLines, lineContentAtCursorPos, lineOffsetAtCursorPos)

	// Calculate the actual line number in the editor by adding the startPos offset
	const finalCursorPos = {
		line: editableRegionStartLine + offset.line,
		character: offset.character,
	}

	return finalCursorPos
}

/**
 * Group diff lines into meaningful sections based on changes.
 * Ported from Continue's diff/diff.ts
 */
export function groupDiffLines(diffLines: DiffLine[], offset: number = 0, maxGroupSize?: number): DiffGroup[] {
	const groups: DiffGroup[] = []
	const changedAreas = findChangedAreas(diffLines)

	for (const area of changedAreas) {
		if (maxGroupSize === undefined) {
			// Mode 1: Flexible group size
			groups.push(processFlexibleSizeGroup(diffLines, area.start, area.end, offset))
		} else {
			// Mode 2: Limited group size
			groups.push(processLimitedSizeGroup(diffLines, area.start, area.end, maxGroupSize, offset))
		}
	}

	return groups
}

/**
 * Find areas of change in the diff lines.
 */
function findChangedAreas(diffLines: DiffLine[]): { start: number; end: number }[] {
	const changedAreas: { start: number; end: number }[] = []
	let changedAreaStart = -1

	for (let i = 0; i < diffLines.length; i++) {
		if (diffLines[i].type !== "same" && changedAreaStart === -1) {
			changedAreaStart = i
		} else if (diffLines[i].type === "same" && changedAreaStart !== -1) {
			// We've found the end of a changed area
			changedAreas.push({ start: changedAreaStart, end: i - 1 })
			changedAreaStart = -1
		}
	}

	// Handle the last changed area if it extends to the end
	if (changedAreaStart !== -1) {
		changedAreas.push({ start: changedAreaStart, end: diffLines.length - 1 })
	}

	return changedAreas
}

/**
 * Count the number of lines in the old content (excluding "new" lines).
 */
function countOldContentLines(diffLines: DiffLine[], startIdx: number, endIdx: number): number {
	let count = 0
	for (let i = startIdx; i <= endIdx; i++) {
		if (diffLines[i].type !== "new") {
			count++
		}
	}
	return count
}

/**
 * Process a changed area with a limited group size.
 */
function processLimitedSizeGroup(
	diffLines: DiffLine[],
	start: number,
	end: number,
	maxGroupSize: number,
	offset: number,
): DiffGroup {
	// Calculate the starting line in old content
	const oldContentLineStart = countOldContentLines(diffLines, 0, start - 1)

	// Track how many lines we have left in our group size budget
	let remainingGroupSize = maxGroupSize
	let currentLine = start
	const lines: DiffLine[] = []

	// Process lines until we hit our size limit or reach the end
	while (currentLine <= end && remainingGroupSize > 0) {
		// Add current line to results if we haven't seen it yet
		if (lines.length === 0 || (lines.length > 0 && lines[lines.length - 1].line !== diffLines[currentLine].line)) {
			lines.push(diffLines[currentLine])
		}

		if (diffLines[currentLine].type === "old") {
			currentLine++
		} else if (diffLines[currentLine].type === "same") {
			remainingGroupSize--
			currentLine++
		} else if (diffLines[currentLine].type === "new") {
			remainingGroupSize--
			currentLine++
		}
	}

	// Adjust for the last increment
	currentLine--

	// Calculate the end line in old content
	const oldContentLineEnd = oldContentLineStart + countOldContentLines(diffLines, start, currentLine) - 1

	return {
		startLine: oldContentLineStart + offset,
		endLine: oldContentLineEnd + offset,
		lines,
	}
}

/**
 * Process a changed area with flexible sizing.
 */
function processFlexibleSizeGroup(diffLines: DiffLine[], start: number, end: number, offset: number): DiffGroup {
	// Calculate the starting line in old content
	const oldContentLineStart = countOldContentLines(diffLines, 0, start - 1)

	// Calculate the end line in old content
	const oldContentLineEnd = oldContentLineStart + countOldContentLines(diffLines, start, end) - 1

	return {
		startLine: oldContentLineStart + offset,
		endLine: oldContentLineEnd + offset,
		lines: diffLines.slice(start, end + 1),
	}
}
