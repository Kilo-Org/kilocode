import { DiffLine } from "./myers"
import { GhostSuggestionEditOperation, GhostSuggestionContext } from "../types"
import { GhostSuggestionsState } from "../GhostSuggestions"

/**
 * Standardized utility to convert Myers diff lines to Ghost operations.
 * This should be used by ALL strategies to ensure consistent behavior.
 *
 * The key insight: Track position in ORIGINAL document for all operations.
 * - Delete operations: Remove at current original position, advance position
 * - Add operations: Insert at current original position, DON'T advance position
 * - Same operations: Advance position (no operation needed)
 */
export function convertDiffLinesToOperations(
	diffLines: DiffLine[],
	startLineInDocument: number,
): GhostSuggestionEditOperation[] {
	const operations: GhostSuggestionEditOperation[] = []
	let currentOriginalLine = startLineInDocument

	// Track if we just processed a deletion to know where to insert additions
	let lastDeletionLine = -1

	for (const diffLine of diffLines) {
		if (diffLine.type === "old") {
			// Line was deleted - remove at current original position
			operations.push({
				type: "-",
				line: currentOriginalLine,
				content: diffLine.line,
				oldLine: currentOriginalLine,
				newLine: currentOriginalLine,
			})
			lastDeletionLine = currentOriginalLine
			currentOriginalLine++ // Advance after deletion
		} else if (diffLine.type === "new") {
			// Line was added - insert at the position where deletion happened, or current position
			const insertLine = lastDeletionLine >= 0 ? lastDeletionLine : currentOriginalLine
			operations.push({
				type: "+",
				line: insertLine,
				content: diffLine.line,
				oldLine: insertLine,
				newLine: insertLine,
			})
			// Don't advance currentOriginalLine for additions
		} else if (diffLine.type === "same") {
			// Line unchanged - advance position (no operation needed)
			lastDeletionLine = -1 // Reset deletion tracking
			currentOriginalLine++
		}
	}

	return operations
}

/**
 * Alternative approach: Convert diff to simple replace operations.
 * This is simpler and more reliable for cases where we want to replace entire regions.
 */
export function convertDiffToReplaceOperations(
	originalContent: string,
	newContent: string,
	startLineInDocument: number,
): GhostSuggestionEditOperation[] {
	// If content is identical, no operations needed
	if (originalContent.trim() === newContent.trim()) {
		return []
	}

	// Simple approach: delete original, add new (like FimStrategy/HoleFillStrategy)
	return [
		{
			type: "-",
			line: startLineInDocument,
			content: originalContent,
			oldLine: startLineInDocument,
			newLine: startLineInDocument,
		},
		{
			type: "+",
			line: startLineInDocument,
			content: newContent,
			oldLine: startLineInDocument,
			newLine: startLineInDocument,
		},
	]
}

/**
 * Consolidated approach for creating suggestions from completion text.
 * This is the pattern that works for FIM, HoleFill, and should work for Mercury.
 * All strategies should use this to eliminate code duplication.
 */
export function createSuggestionsFromCompletion(
	completionText: string,
	context: GhostSuggestionContext,
	targetLines?: { startLine: number; endLine: number },
): GhostSuggestionsState {
	const suggestions = new GhostSuggestionsState()

	if (!context.document || !context.range || !completionText) {
		return suggestions
	}

	const document = context.document
	const position = context.range.start
	const suggestionFile = suggestions.addFile(document.uri)

	if (targetLines) {
		// Mercury case: replace specific line range with completion
		const originalLines = document.getText().split("\n")

		// Delete all lines in the target range
		for (let i = targetLines.startLine; i <= targetLines.endLine; i++) {
			if (i < originalLines.length) {
				suggestionFile.addOperation({
					type: "-",
					line: i,
					oldLine: i,
					newLine: i,
					content: originalLines[i],
				})
			}
		}

		// Add the completion content at the start line
		suggestionFile.addOperation({
			type: "+",
			line: targetLines.startLine,
			oldLine: targetLines.startLine,
			newLine: targetLines.startLine,
			content: completionText,
		})
	} else {
		// FIM/HoleFill case: replace at cursor position
		const line = position.line
		const character = position.character
		const currentLine = document.lineAt(line)
		const lineText = currentLine.text

		// Check if this is an inline completion or line completion
		const isInlineCompletion = lineText.trim().length > 0 && character <= lineText.length

		if (isInlineCompletion) {
			// Inline completion: replace line with completion inserted at cursor
			const beforeCursor = lineText.substring(0, character)
			const afterCursor = lineText.substring(character)
			const newLineContent = beforeCursor + completionText + afterCursor

			suggestionFile.addOperation({
				type: "-",
				line: line,
				oldLine: line,
				newLine: line,
				content: lineText,
			})

			suggestionFile.addOperation({
				type: "+",
				line: line,
				oldLine: line,
				newLine: line,
				content: newLineContent,
			})
		} else {
			// Line completion: replace empty line with completion (preserve indentation)
			const leadingWhitespace = lineText.match(/^(\s*)/)?.[1] || ""
			const completionLines = completionText.split("\n")
			const indentedCompletion = completionLines
				.map((line, index) => {
					return index === 0 ? leadingWhitespace + line : line
				})
				.join("\n")

			suggestionFile.addOperation({
				type: "-",
				line: line,
				oldLine: line,
				newLine: line,
				content: "",
			})

			suggestionFile.addOperation({
				type: "+",
				line: line,
				oldLine: line,
				newLine: line,
				content: indentedCompletion,
			})
		}
	}

	return suggestions
}
