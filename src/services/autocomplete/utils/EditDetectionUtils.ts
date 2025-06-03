import * as vscode from "vscode"

/**
 * Determines if an edit is likely from human typing rather than an AI tool, copy-paste, or other automated source
 * Uses multiple heuristics to distinguish between human typing and automated/programmatic edits
 * Prioritizes not triggering autocomplete on automated edits (false positives preferred over false negatives)
 */
export function isHumanEdit(e: vscode.TextDocumentChangeEvent): boolean {
	// VSCode doesn't directly expose if an edit is programmatic vs user-initiated
	// But we can use heuristics to make an educated guess

	// 1. Check if the edit has a reason property indicating it's from an undo/redo operation
	if (e.reason === vscode.TextDocumentChangeReason.Undo || e.reason === vscode.TextDocumentChangeReason.Redo) {
		return true // Undo/redo operations are user-initiated
	}

	// 2. Check for multiple changes in a single edit event
	// AI tools and other extensions often make multiple changes at once
	if (e.contentChanges.length > 1) {
		return false
	}

	// 3. For single changes, analyze the characteristics in detail
	if (e.contentChanges.length === 1) {
		const change = e.contentChanges[0]

		// 3a. If it's purely a deletion, it's likely user-initiated (backspace, delete key, etc.)
		if (change.text.length === 0 && change.rangeLength > 0) {
			return true
		}

		// 3b. Large text insertions are likely from AI tools or copy-paste
		// We use a conservative threshold to avoid false positives
		const totalChangedChars = change.text.length + change.rangeLength
		if (totalChangedChars > 100) {
			return false
		}

		// 3c. Check for copy-paste characteristics
		// Copy-paste operations typically insert multiple lines at once
		const newlineCount = (change.text.match(/\n/g) || []).length
		if (newlineCount > 2 && change.text.length > 50) {
			return false // Multi-line pastes with substantial content
		}

		// 3d. Check for code-like patterns that suggest AI generation or copy-paste
		if (change.text.length > 30) {
			// Look for code structure patterns
			const hasCodePatterns = /function|class|import|export|const|let|var|if|for|while/.test(change.text)
			const hasIndentation = /\n\s+/.test(change.text) // Indented lines after newlines

			if (hasCodePatterns && hasIndentation) {
				return false // Structured code is likely AI-generated or copy-pasted
			}
		}
	}

	// Default to assuming it's a human edit if we can't determine otherwise
	return true
}
