import * as vscode from "vscode"
import { MockTextDocument } from "./MockTextDocument"

/**
 * Special character used to mark cursor position in test documents.
 * Using "␣" (U+2423, OPEN BOX) as it's visually distinct and unlikely to be in normal code.
 */
export const CURSOR_MARKER = "␣"

/**
 * MockTextEditor encapsulates both a TextDocument and cursor position
 * for simpler testing of editor-related functionality
 */
export class MockTextEditor {
	public readonly document: vscode.TextDocument
	public selection: vscode.Selection

	/**
	 * Creates a new MockTextEditor
	 * @param content Text content with optional cursor marker (CURSOR_MARKER)
	 *                If no cursor marker is provided, cursor defaults to position (0,0)
	 */
	constructor(content: string) {
		const cursorOffset = content.indexOf(CURSOR_MARKER)

		if (cursorOffset === -1) {
			// No cursor marker found - default to position (0,0)
			const uri = vscode.Uri.parse("untitled:mockEditor")
			this.document = new MockTextDocument(uri, content) as unknown as vscode.TextDocument
			const defaultPosition = new vscode.Position(0, 0)
			this.selection = new vscode.Selection(defaultPosition, defaultPosition)
		} else {
			// Cursor marker found - remove it and calculate position
			const cleanContent =
				content.substring(0, cursorOffset) + content.substring(cursorOffset + CURSOR_MARKER.length)

			const uri = vscode.Uri.parse("untitled:mockEditor")
			// Create document without cursor marker
			this.document = new MockTextDocument(uri, cleanContent) as unknown as vscode.TextDocument

			// Calculate line and character for cursor position
			const beforeCursor = content.substring(0, cursorOffset)
			const lines = beforeCursor.split("\n")
			const line = lines.length - 1
			const character = lines[line].length

			const cursorPosition = new vscode.Position(line, character)
			this.selection = new vscode.Selection(cursorPosition, cursorPosition)
		}
	}

	static create(content: string): MockTextEditor {
		return new MockTextEditor(content)
	}
}
