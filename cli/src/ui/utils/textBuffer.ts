/**
 * TextBuffer - A utility class for managing multiline text with cursor positioning
 * Inspired by Gemini CLI's text buffer implementation but simplified for our needs
 */

export interface CursorPosition {
	row: number
	column: number
}

export interface VisualLine {
	text: string
	logicalRow: number
	logicalStartCol: number
	logicalEndCol: number
}

export class TextBuffer {
	private _lines: string[]
	private _cursor: CursorPosition

	constructor(initialText: string = "") {
		this._lines = initialText ? initialText.split("\n") : [""]
		this._cursor = { row: 0, column: 0 }
		this.moveToEnd()
	}

	// ============= Getters =============

	get lines(): string[] {
		return [...this._lines]
	}

	get cursor(): CursorPosition {
		return { ...this._cursor }
	}

	get text(): string {
		return this._lines.join("\n")
	}

	get currentLine(): string {
		return this._lines[this._cursor.row] || ""
	}

	get lineCount(): number {
		return this._lines.length
	}

	get isEmpty(): boolean {
		return this._lines.length === 1 && this._lines[0] === ""
	}

	// ============= Setters =============

	setText(text: string): void {
		this._lines = text ? text.split("\n") : [""]
		this.moveToEnd()
	}

	clear(): void {
		this._lines = [""]
		this._cursor = { row: 0, column: 0 }
	}

	// ============= Cursor Movement =============

	moveUp(): boolean {
		if (this._cursor.row > 0) {
			this._cursor.row--
			const line = this._lines[this._cursor.row]
			if (line !== undefined) {
				this._cursor.column = Math.min(this._cursor.column, line.length)
			}
			return true
		}
		return false
	}

	moveDown(): boolean {
		if (this._cursor.row < this._lines.length - 1) {
			this._cursor.row++
			const line = this._lines[this._cursor.row]
			if (line !== undefined) {
				this._cursor.column = Math.min(this._cursor.column, line.length)
			}
			return true
		}
		return false
	}

	moveLeft(): boolean {
		if (this._cursor.column > 0) {
			this._cursor.column--
			return true
		} else if (this._cursor.row > 0) {
			// Move to end of previous line
			this._cursor.row--
			const line = this._lines[this._cursor.row]
			this._cursor.column = line ? line.length : 0
			return true
		}
		return false
	}

	moveRight(): boolean {
		const currentLine = this._lines[this._cursor.row]
		const currentLineLength = currentLine ? currentLine.length : 0
		if (this._cursor.column < currentLineLength) {
			this._cursor.column++
			return true
		} else if (this._cursor.row < this._lines.length - 1) {
			// Move to start of next line
			this._cursor.row++
			this._cursor.column = 0
			return true
		}
		return false
	}

	moveToLineStart(): void {
		this._cursor.column = 0
	}

	moveToLineEnd(): void {
		const line = this._lines[this._cursor.row]
		this._cursor.column = line ? line.length : 0
	}

	moveToStart(): void {
		this._cursor = { row: 0, column: 0 }
	}

	moveToEnd(): void {
		const lastRow = this._lines.length - 1
		const lastLine = this._lines[lastRow]
		this._cursor = {
			row: lastRow,
			column: lastLine ? lastLine.length : 0,
		}
	}

	moveTo(row: number, column: number): void {
		this._cursor.row = Math.max(0, Math.min(row, this._lines.length - 1))
		const line = this._lines[this._cursor.row]
		this._cursor.column = Math.max(0, Math.min(column, line ? line.length : 0))
	}

	// ============= Text Editing =============

	insertChar(char: string): void {
		if (char === "\n") {
			this.insertNewline()
			return
		}

		const line = this._lines[this._cursor.row]
		if (line !== undefined) {
			this._lines[this._cursor.row] = line.slice(0, this._cursor.column) + char + line.slice(this._cursor.column)
			this._cursor.column++
		}
	}
	insertText(text: string): void {
		if (!text) return
		const lines = text.split("\n")
		if (lines.length === 1) {
			// Single line insert
			const line = this._lines[this._cursor.row]
			if (line !== undefined) {
				this._lines[this._cursor.row] =
					line.slice(0, this._cursor.column) + text + line.slice(this._cursor.column)
				this._cursor.column += text.length
			}
		} else {
			// Multiline insert
			const currentLine = this._lines[this._cursor.row] || ""
			const beforeCursor = currentLine.slice(0, this._cursor.column)
			const afterCursor = currentLine.slice(this._cursor.column)

			// First line combines with text before cursor
			const firstLine = lines[0]
			if (firstLine !== undefined) {
				this._lines[this._cursor.row] = beforeCursor + firstLine
			}

			// Insert middle lines
			for (let i = 1; i < lines.length - 1; i++) {
				const middleLine = lines[i]
				if (middleLine !== undefined) {
					this._lines.splice(this._cursor.row + i, 0, middleLine)
				}
			}

			// Last line combines with text after cursor
			const lastLineIndex = this._cursor.row + lines.length - 1
			const lastLine = lines[lines.length - 1]
			if (lines.length > 1 && lastLine !== undefined) {
				this._lines.splice(lastLineIndex, 0, lastLine + afterCursor)
			}

			// Update cursor position
			this._cursor.row = lastLineIndex
			this._cursor.column = lastLine ? lastLine.length : 0
		}
	}

	insertNewline(): void {
		const currentLine = this._lines[this._cursor.row] || ""
		const beforeCursor = currentLine.slice(0, this._cursor.column)
		const afterCursor = currentLine.slice(this._cursor.column)

		this._lines[this._cursor.row] = beforeCursor
		this._lines.splice(this._cursor.row + 1, 0, afterCursor)

		this._cursor.row++
		this._cursor.column = 0
	}

	backspace(): boolean {
		if (this._cursor.column > 0) {
			// Delete character before cursor
			const line = this._lines[this._cursor.row]
			if (line !== undefined) {
				this._lines[this._cursor.row] = line.slice(0, this._cursor.column - 1) + line.slice(this._cursor.column)
				this._cursor.column--
			}
			return true
		} else if (this._cursor.row > 0) {
			// Join with previous line
			const currentLine = this._lines[this._cursor.row] || ""
			const previousLine = this._lines[this._cursor.row - 1] || ""
			this._cursor.column = previousLine.length
			this._lines[this._cursor.row - 1] = previousLine + currentLine
			this._lines.splice(this._cursor.row, 1)
			this._cursor.row--
			return true
		}
		return false
	}
	deleteChar(): boolean {
		const currentLine = this._lines[this._cursor.row] || ""
		if (this._cursor.column < currentLine.length) {
			// Delete character at cursor
			this._lines[this._cursor.row] =
				currentLine.slice(0, this._cursor.column) + currentLine.slice(this._cursor.column + 1)
			return true
		} else if (this._cursor.row < this._lines.length - 1) {
			// Join with next line
			const nextLine = this._lines[this._cursor.row + 1] || ""
			this._lines[this._cursor.row] = currentLine + nextLine
			this._lines.splice(this._cursor.row + 1, 1)
			return true
		}
		return false
	}

	deleteWord(): void {
		const line = this._lines[this._cursor.row]
		if (!line) return

		let startPos = this._cursor.column

		// If we're at the start of the line, do backspace instead
		if (startPos === 0) {
			this.backspace()
			return
		}

		// Skip any trailing spaces
		while (startPos > 0 && line[startPos - 1] === " ") {
			startPos--
		}

		// Delete the word
		while (startPos > 0 && line[startPos - 1] !== " ") {
			startPos--
		}

		this._lines[this._cursor.row] = line.slice(0, startPos) + line.slice(this._cursor.column)
		this._cursor.column = startPos
	}

	killLine(): void {
		const line = this._lines[this._cursor.row]
		if (line !== undefined) {
			this._lines[this._cursor.row] = line.slice(0, this._cursor.column)
		}
	}

	killLineLeft(): void {
		const line = this._lines[this._cursor.row]
		if (line !== undefined) {
			this._lines[this._cursor.row] = line.slice(this._cursor.column)
			this._cursor.column = 0
		}
	}

	// ============= Visual Rendering =============

	/**
	 * Get visual lines with word wrapping
	 * @param width - Maximum width for each line
	 * @param maxLines - Maximum number of lines to return (for viewport)
	 * @returns Array of visual lines with mapping to logical lines
	 */
	getVisualLines(width: number, maxLines?: number): VisualLine[] {
		if (width <= 0) return []

		const visualLines: VisualLine[] = []

		for (let rowIndex = 0; rowIndex < this._lines.length; rowIndex++) {
			const line = this._lines[rowIndex]

			// Handle undefined lines (shouldn't happen but be safe)
			if (line === undefined) {
				visualLines.push({
					text: "",
					logicalRow: rowIndex,
					logicalStartCol: 0,
					logicalEndCol: 0,
				})
				continue
			}

			// Handle empty lines
			if (line.length === 0) {
				visualLines.push({
					text: "",
					logicalRow: rowIndex,
					logicalStartCol: 0,
					logicalEndCol: 0,
				})
				continue
			}

			// Simple character-based wrapping (can be improved with word boundaries)
			let startCol = 0
			while (startCol < line.length) {
				const endCol = Math.min(startCol + width, line.length)
				visualLines.push({
					text: line.slice(startCol, endCol),
					logicalRow: rowIndex,
					logicalStartCol: startCol,
					logicalEndCol: endCol,
				})
				startCol = endCol

				if (maxLines && visualLines.length >= maxLines) {
					return visualLines
				}
			}
		}

		return visualLines
	}

	/**
	 * Get the visual cursor position accounting for line wrapping
	 * @param width - Maximum width for each line
	 * @returns Visual row and column position
	 */
	getVisualCursor(width: number): CursorPosition {
		if (width <= 0) return { row: 0, column: 0 }

		let visualRow = 0

		// Count visual rows before cursor row
		for (let row = 0; row < this._cursor.row; row++) {
			const line = this._lines[row]
			const lineLength = line ? line.length : 1
			visualRow += Math.ceil(lineLength / width)
		}

		// Add visual rows for current line up to cursor
		const currentLine = this._lines[this._cursor.row]
		const wrappedRows = Math.floor(this._cursor.column / width)
		visualRow += wrappedRows

		const visualColumn = this._cursor.column % width

		return { row: visualRow, column: visualColumn }
	}

	/**
	 * Get a slice of visual lines for viewport rendering
	 * @param width - Maximum width for each line
	 * @param viewportHeight - Height of the viewport
	 * @param scrollOffset - Current scroll offset
	 * @returns Visual lines to display and cursor position within viewport
	 */
	getViewport(
		width: number,
		viewportHeight: number,
		scrollOffset: number = 0,
	): {
		lines: VisualLine[]
		cursorInViewport: CursorPosition | null
	} {
		const allVisualLines = this.getVisualLines(width)
		const visualCursor = this.getVisualCursor(width)

		// Ensure scroll offset is valid
		const maxScroll = Math.max(0, allVisualLines.length - viewportHeight)
		const actualScroll = Math.max(0, Math.min(scrollOffset, maxScroll))

		// Get visible lines
		const visibleLines = allVisualLines.slice(actualScroll, actualScroll + viewportHeight)

		// Check if cursor is in viewport
		let cursorInViewport: CursorPosition | null = null
		if (visualCursor.row >= actualScroll && visualCursor.row < actualScroll + viewportHeight) {
			cursorInViewport = {
				row: visualCursor.row - actualScroll,
				column: visualCursor.column,
			}
		}

		return {
			lines: visibleLines,
			cursorInViewport,
		}
	}

	/**
	 * Calculate scroll offset to keep cursor in view
	 * @param width - Maximum width for each line
	 * @param viewportHeight - Height of the viewport
	 * @param currentScroll - Current scroll offset
	 * @returns New scroll offset
	 */
	getScrollToCursor(width: number, viewportHeight: number, currentScroll: number): number {
		const visualCursor = this.getVisualCursor(width)

		// If cursor is above viewport, scroll up
		if (visualCursor.row < currentScroll) {
			return visualCursor.row
		}

		// If cursor is below viewport, scroll down
		if (visualCursor.row >= currentScroll + viewportHeight) {
			return visualCursor.row - viewportHeight + 1
		}

		// Cursor is in view, no scroll needed
		return currentScroll
	}
}
