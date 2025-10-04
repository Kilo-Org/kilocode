/**
 * Diff Formatting System
 * Based on Continue's diffFormatting.ts for proper unified diff generation
 */

export enum DiffFormatType {
	Unified = "unified",
	RawBeforeAfter = "beforeAfter",
	TokenLineDiff = "linediff",
}

export interface CreateDiffArgs {
	beforeContent: string
	afterContent: string
	filePath: string
	diffType: DiffFormatType
	contextLines: number
}

export interface BeforeAfterDiff {
	filePath: string
	beforeContent: string
	afterContent: string
}

/**
 * Create a unified diff between two content versions
 * Simplified version of Continue's createPatch functionality
 */
export const createDiff = ({
	beforeContent,
	afterContent,
	filePath,
	diffType,
	contextLines,
}: CreateDiffArgs): string => {
	switch (diffType) {
		case DiffFormatType.Unified:
			return createUnifiedDiff(beforeContent, afterContent, filePath, contextLines)
		case DiffFormatType.TokenLineDiff:
			return createTokenLineDiff(beforeContent, afterContent, filePath)
		default:
			return ""
	}
}

/**
 * Create unified diff format (like git diff)
 */
const createUnifiedDiff = (
	beforeContent: string,
	afterContent: string,
	filePath: string,
	contextLines: number,
): string => {
	const normalizedBefore = beforeContent.endsWith("\n") ? beforeContent : beforeContent + "\n"
	const normalizedAfter = afterContent.endsWith("\n") ? afterContent : afterContent + "\n"

	const beforeLines = normalizedBefore.split("\n")
	const afterLines = normalizedAfter.split("\n")

	// Simple diff implementation
	let diff = `--- ${filePath}\tbefore\n`
	diff += `+++ ${filePath}\tafter\n`

	// Find differences using simple line-by-line comparison
	const changes: Array<{
		type: "add" | "remove" | "context"
		line: string
		beforeLineNum?: number
		afterLineNum?: number
	}> = []

	let beforeIdx = 0
	let afterIdx = 0

	while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
		const beforeLine = beforeLines[beforeIdx]
		const afterLine = afterLines[afterIdx]

		if (beforeIdx >= beforeLines.length) {
			// Only after lines remain (additions)
			changes.push({
				type: "add",
				line: afterLine,
				afterLineNum: afterIdx + 1,
			})
			afterIdx++
		} else if (afterIdx >= afterLines.length) {
			// Only before lines remain (deletions)
			changes.push({
				type: "remove",
				line: beforeLine,
				beforeLineNum: beforeIdx + 1,
			})
			beforeIdx++
		} else if (beforeLine === afterLine) {
			// Lines match (context)
			changes.push({
				type: "context",
				line: beforeLine,
				beforeLineNum: beforeIdx + 1,
				afterLineNum: afterIdx + 1,
			})
			beforeIdx++
			afterIdx++
		} else {
			// Lines differ
			changes.push({
				type: "remove",
				line: beforeLine,
				beforeLineNum: beforeIdx + 1,
			})
			changes.push({
				type: "add",
				line: afterLine,
				afterLineNum: afterIdx + 1,
			})
			beforeIdx++
			afterIdx++
		}
	}

	// Generate hunk header
	if (changes.length > 0) {
		const firstChange = changes.find((c) => c.type !== "context")
		const lastChange = changes[changes.length - 1]

		const startBefore = Math.max(1, (firstChange?.beforeLineNum || 1) - contextLines)
		const startAfter = Math.max(1, (firstChange?.afterLineNum || 1) - contextLines)
		const countBefore = beforeLines.length
		const countAfter = afterLines.length

		diff += `@@ -${startBefore},${countBefore} +${startAfter},${countAfter} @@\n`

		// Add the actual changes
		for (const change of changes) {
			switch (change.type) {
				case "context":
					diff += ` ${change.line}\n`
					break
				case "remove":
					diff += `-${change.line}\n`
					break
				case "add":
					diff += `+${change.line}\n`
					break
			}
		}
	}

	return diff
}

const createTokenLineDiff = (beforeContent: string, afterContent: string, filePath: string): string => {
	// TODO: Implement token line diff if needed
	return ""
}

/**
 * Create before/after diff format
 */
export const createBeforeAfterDiff = (
	beforeContent: string,
	afterContent: string,
	filePath: string,
): BeforeAfterDiff => {
	const normalizedBefore = beforeContent.endsWith("\n") ? beforeContent : beforeContent + "\n"
	const normalizedAfter = afterContent.endsWith("\n") ? afterContent : afterContent + "\n"

	return {
		filePath: filePath,
		beforeContent: normalizedBefore,
		afterContent: normalizedAfter,
	}
}
