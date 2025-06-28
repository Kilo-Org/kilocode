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
	private _document: vscode.TextDocument
	private _cursorPosition: vscode.Position

	/**
	 * Creates a new MockTextEditor
	 * @param content Text content with required cursor marker (CURSOR_MARKER)
	 */
	constructor(content: string) {
		// Find cursor position and remove the marker
		const cursorOffset = content.indexOf(CURSOR_MARKER)
		if (cursorOffset === -1) {
			throw new Error(`Cursor marker ${CURSOR_MARKER} not found in test content`)
		}

		// Remove the cursor marker
		const cleanContent = content.substring(0, cursorOffset) + content.substring(cursorOffset + CURSOR_MARKER.length)

		// Calculate line and character for cursor position
		const beforeCursor = content.substring(0, cursorOffset)
		const lines = beforeCursor.split("\n")
		const line = lines.length - 1
		const character = lines[line].length

		this._cursorPosition = new vscode.Position(line, character)
		this._document = new MockTextDocument(cleanContent) as unknown as vscode.TextDocument
	}

	get document(): vscode.TextDocument {
		return this._document
	}

	get cursorPosition(): vscode.Position {
		return this._cursorPosition
	}

	static create(content: string): MockTextEditor {
		return new MockTextEditor(content)
	}
}
