import * as vscode from "vscode"

/**
 * Creates document content with a placeholder at the cursor position and extracts
 * lines before and after the cursor line for caching purposes
 *
 * @param document The text document to get content from
 * @param position The position where the placeholder should be inserted
 * @returns Object containing document text with placeholder and cache-friendly line segments
 */
export interface DocumentWithPlaceholder {
	textWithPlaceholder: string
	linesBeforeCursor: string
	linesAfterCursor: string
	currentLinePrefix: string
	currentLineSuffix: string
	cursorLineNumber: number
}

export function getDocumentTextWithPlaceholder(
	document: vscode.TextDocument,
	position: vscode.Position,
): DocumentWithPlaceholder {
	// Get the entire document text
	const documentText = document.getText()
	const lineCount = document.lineCount

	// Calculate the offset for the cursor position
	const offset = document.offsetAt(position)

	// Get current line and its parts
	const currentLine = document.lineAt(position.line)
	const currentLinePrefix = currentLine.text.substring(0, position.character)
	const currentLineSuffix = currentLine.text.substring(position.character)

	// Extract lines before cursor line
	let linesBeforeCursor = ""
	for (let i = 0; i < position.line; i++) {
		linesBeforeCursor += document.lineAt(i).text + "\n"
	}

	// Extract lines after cursor line
	let linesAfterCursor = ""
	for (let i = position.line + 1; i < lineCount; i++) {
		linesAfterCursor += document.lineAt(i).text + "\n"
	}

	// Insert the placeholder at the cursor position
	const textWithPlaceholder = documentText.substring(0, offset) + "{{FILL_HERE}}" + documentText.substring(offset)

	return {
		textWithPlaceholder,
		linesBeforeCursor,
		linesAfterCursor,
		currentLinePrefix,
		currentLineSuffix,
		cursorLineNumber: position.line,
	}
}
