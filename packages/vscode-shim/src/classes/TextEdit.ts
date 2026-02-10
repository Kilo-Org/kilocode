import { Position } from "./Position.js"
import { Range } from "./Range.js"
import type { IRange, IPosition } from "../types.js"

/**
 * Represents a text edit operation
 *
 * A text edit replaces text in a specific range with new text.
 * This is used to modify documents programmatically.
 *
 * @example
 * ```typescript
 * // Replace text in a range
 * const edit = TextEdit.replace(
 *   new Range(0, 0, 0, 5),
 *   'Hello'
 * )
 *
 * // Insert text at a position
 * const insert = TextEdit.insert(
 *   new Position(0, 0),
 *   'New text'
 * )
 *
 * // Delete text in a range
 * const deletion = TextEdit.delete(
 *   new Range(0, 0, 0, 10)
 * )
 * ```
 */
export class TextEdit {
	/**
	 * The range to replace
	 */
	public readonly range: Range

	/**
	 * The new text (empty string for deletion)
	 */
	public readonly newText: string

	/**
	 * Create a new TextEdit
	 *
	 * @param range - The range to replace
	 * @param newText - The new text
	 */
	constructor(range: IRange, newText: string) {
		this.range = range as Range
		this.newText = newText
	}

	/**
	 * Create a replace edit
	 *
	 * @param range - The range to replace
	 * @param newText - The new text
	 * @returns A new TextEdit
	 */
	static replace(range: IRange, newText: string): TextEdit {
		return new TextEdit(range, newText)
	}

	/**
	 * Create an insert edit
	 *
	 * @param position - The position to insert at
	 * @param newText - The text to insert
	 * @returns A new TextEdit
	 */
	static insert(position: IPosition, newText: string): TextEdit {
		return new TextEdit(new Range(position, position), newText)
	}

	/**
	 * Create a delete edit
	 *
	 * @param range - The range to delete
	 * @returns A new TextEdit
	 */
	static delete(range: IRange): TextEdit {
		return new TextEdit(range, "")
	}

	/**
	 * Create an edit to set the end of line sequence
	 *
	 * @returns A new TextEdit (simplified implementation)
	 */
	static setEndOfLine(): TextEdit {
		return new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), "")
	}
}

/**
 * Represents a collection of text edits for a document
 *
 * A WorkspaceEdit can contain edits for multiple documents.
 *
 * @example
 * ```typescript
 * const edit = new WorkspaceEdit()
 *
 * // Add edits for a file
 * edit.set(uri, [
 *   TextEdit.replace(range1, 'new text'),
 *   TextEdit.insert(pos, 'inserted')
 * ])
 *
 * // Apply the edit
 * await vscode.workspace.applyEdit(edit)
 * ```
 */
export class WorkspaceEdit {
	private _edits: Map<string, TextEdit[]> = new Map()

	/**
	 * Set edits for a specific URI
	 *
	 * @param uri - The document URI
	 * @param edits - Array of text edits
	 */
	set(uri: { toString(): string }, edits: TextEdit[]): void {
		this._edits.set(uri.toString(), edits)
	}

	/**
	 * Get edits for a specific URI
	 *
	 * @param uri - The document URI
	 * @returns Array of text edits, or empty array if none
	 */
	get(uri: { toString(): string }): TextEdit[] {
		return this._edits.get(uri.toString()) || []
	}

	/**
	 * Check if edits exist for a URI
	 *
	 * @param uri - The document URI
	 * @returns true if edits exist
	 */
	has(uri: { toString(): string }): boolean {
		return this._edits.has(uri.toString())
	}

	/**
	 * Add a delete edit for a range
	 *
	 * @param uri - The document URI
	 * @param range - The range to delete
	 */
	delete(uri: { toString(): string }, range: IRange): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.delete(range))
	}

	/**
	 * Add an insert edit
	 *
	 * @param uri - The document URI
	 * @param position - The position to insert at
	 * @param newText - The text to insert
	 */
	insert(uri: { toString(): string }, position: IPosition, newText: string): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.insert(position, newText))
	}

	/**
	 * Add a replace edit
	 *
	 * @param uri - The document URI
	 * @param range - The range to replace
	 * @param newText - The new text
	 */
	replace(uri: { toString(): string }, range: IRange, newText: string): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.replace(range, newText))
	}

	/**
	 * Get the number of documents with edits
	 */
	get size(): number {
		return this._edits.size
	}

	/**
	 * Get all URI and edits pairs
	 *
	 * @returns Array of [URI, TextEdit[]] pairs
	 */
	entries(): [{ toString(): string; fsPath: string }, TextEdit[]][] {
		return Array.from(this._edits.entries()).map(([uriString, edits]) => {
			// Parse the URI string back to a URI-like object
			return [{ toString: () => uriString, fsPath: uriString.replace(/^file:\/\//, "") }, edits]
		})
	}
}
