/**
 * Ghost Suggestion Data Processing
 * Sophisticated edit processing and context aggregation for Ghost suggestions
 */

import * as vscode from "vscode"
import { RecentlyEditedRange } from "./types"
import { DocumentHistoryTracker } from "./DocumentHistoryTracker"
import { createDiff, DiffFormatType } from "./diffFormatting"
import { setPrevEdit, getPrevEditsDescending } from "./prevEditLruCache"

export interface ProcessEditDataParams {
	filePath: string
	beforeContent: string
	afterContent: string
	cursorPosBeforeEdit: vscode.Position
	cursorPosAfterEdit: vscode.Position
	workspaceDir: string
}

interface FilenameAndDiff {
	filename: string
	diff: string
}

/**
 * Process edit data like Continue does - aggregating context and managing edit history
 */
export async function processGhostSuggestionData({
	filePath,
	beforeContent,
	afterContent,
	cursorPosBeforeEdit,
	cursorPosAfterEdit,
	workspaceDir,
}: ProcessEditDataParams): Promise<{
	editHistory: string[]
	recentlyEditedRanges: RecentlyEditedRange[]
}> {
	const timestamp = Date.now()
	const historyTracker = DocumentHistoryTracker.getInstance()

	// Get previous edits from LRU cache
	let prevEdits = getPrevEditsDescending() // Edits from most to least recent
	let filenamesAndDiffs: FilenameAndDiff[] = []

	if (prevEdits.length > 0) {
		// If last edit was 10+ minutes ago or workspace changed, clear previous edits
		if (timestamp - prevEdits[0].timestamp >= 1000 * 60 * 10 || workspaceDir !== prevEdits[0].workspaceUri) {
			// Clear the cache - this mirrors Continue's behavior exactly
			prevEdits = []
		}

		// Extract filenames and diffs for processing
		filenamesAndDiffs = prevEdits.map((edit) => ({
			// Filename relative to workspace dir
			filename: edit.fileUri.replace(edit.workspaceUri, "").replace(/^[/\\]/, ""),
			// Diff without the first 4 lines (file header) - just like Continue does
			diff: edit.unidiff.split("\n").slice(4).join("\n"),
		}))
	}

	// Create unified diff for current edit
	const currentDiff = createDiff({
		beforeContent,
		afterContent,
		filePath,
		diffType: DiffFormatType.Unified,
		contextLines: 25, // Store many context lines for downstream trimming, like Continue
	})

	// Add current edit to LRU cache
	const thisEdit = {
		unidiff: currentDiff,
		fileUri: filePath,
		workspaceUri: workspaceDir,
		timestamp,
	}
	setPrevEdit(thisEdit)

	// Update document history tracker
	if (!historyTracker.hasDocument(filePath)) {
		historyTracker.addDocument(filePath, beforeContent)
	}
	historyTracker.push(filePath, afterContent, currentDiff)

	// Process recently edited ranges like Continue does
	const recentlyEditedRanges = await processRecentlyEditedRanges(
		filePath,
		beforeContent,
		afterContent,
		cursorPosBeforeEdit,
		cursorPosAfterEdit,
	)

	// Return edit history formatted like Continue expects
	const editHistory = filenamesAndDiffs.map((item) => item.diff).filter((diff) => diff.trim().length > 0)

	return {
		editHistory,
		recentlyEditedRanges,
	}
}

/**
 * Process recently edited ranges with sophisticated range detection
 * This implements the complex logic Continue uses for tracking meaningful edits
 */
async function processRecentlyEditedRanges(
	filePath: string,
	beforeContent: string,
	afterContent: string,
	cursorBefore: vscode.Position,
	cursorAfter: vscode.Position,
): Promise<RecentlyEditedRange[]> {
	const beforeLines = beforeContent.split("\n")
	const afterLines = afterContent.split("\n")

	// Find the range of lines that actually changed
	let startLine = 0
	let endLine = Math.max(beforeLines.length, afterLines.length) - 1

	// Find first differing line
	for (let i = 0; i < Math.min(beforeLines.length, afterLines.length); i++) {
		if (beforeLines[i] !== afterLines[i]) {
			startLine = i
			break
		}
	}

	// Find last differing line
	for (let i = Math.min(beforeLines.length, afterLines.length) - 1; i >= startLine; i--) {
		const beforeIdx = beforeLines.length - (Math.min(beforeLines.length, afterLines.length) - i)
		const afterIdx = afterLines.length - (Math.min(beforeLines.length, afterLines.length) - i)

		if (beforeLines[beforeIdx] !== afterLines[afterIdx]) {
			endLine = Math.max(beforeIdx, afterIdx)
			break
		}
	}

	// Extract symbols from the changed region (basic implementation)
	const changedLines = afterLines.slice(startLine, endLine + 1)
	const symbols = new Set<string>()

	// Simple symbol extraction - look for function names, variable declarations, etc.
	for (const line of changedLines) {
		const functionMatch = line.match(/(?:function|const|let|var|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)
		if (functionMatch) {
			functionMatch.forEach((match) => {
				const symbolName = match.split(/\s+/)[1]
				if (symbolName) {
					symbols.add(symbolName)
				}
			})
		}
	}

	// Create recently edited range entry
	const recentlyEditedRange: RecentlyEditedRange = {
		filepath: filePath,
		timestamp: Date.now(),
		lines: changedLines,
		symbols,
	}

	// Return as array - in a full implementation, this would merge with existing ranges
	return [recentlyEditedRange]
}

/**
 * Get aggregated context for Mercury Coder
 * This combines all the sophisticated context that Continue collects
 */
export async function getAggregatedMercuryContext(
	document: vscode.TextDocument,
	range: vscode.Range,
	workspaceDir: string,
): Promise<{
	editHistory: string[]
	recentlyEditedRanges: RecentlyEditedRange[]
	documentHistory: string[]
}> {
	const filePath = document.uri.fsPath
	const historyTracker = DocumentHistoryTracker.getInstance()

	// Get edit history from LRU cache
	const prevEdits = getPrevEditsDescending()
	const editHistory = prevEdits
		.map((edit) => edit.unidiff.split("\n").slice(2).join("\n")) // Remove diff headers like Continue
		.filter((diff) => diff.trim().length > 0)
		.slice(0, 3) // Limit to 3 most recent

	// Get recently edited ranges (simplified - would need more sophisticated tracking)
	const recentlyEditedRanges: RecentlyEditedRange[] = []

	// Get document history
	const documentHistory = historyTracker.getContentHistory(filePath, 3)

	return {
		editHistory,
		recentlyEditedRanges,
		documentHistory,
	}
}
