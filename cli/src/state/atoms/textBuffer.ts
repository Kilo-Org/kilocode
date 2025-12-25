/**
 * Atom-based text buffer system
 * Replaces the TextBuffer class with efficient Jotai atoms
 * This eliminates the need to create new TextBuffer instances on every keystroke
 */

import { atom } from "jotai"

// ============================================================================
// Types
// ============================================================================

export interface CursorPosition {
	row: number
	column: number
}

export interface TextBufferState {
	lines: string[]
	cursor: CursorPosition
}

export interface VisualLine {
	text: string
	logicalRow: number
	logicalStartCol: number
	logicalEndCol: number
}

// ============================================================================
// Core State Atom
// ============================================================================

/**
 * Core text buffer state
 * Contains the lines of text and cursor position
 */
export const textBufferStateAtom = atom<TextBufferState>({
	lines: [""],
	cursor: { row: 0, column: 0 },
})

// ============================================================================
// Derived Atoms (Read-only)
// ============================================================================

/**
 * Get the full text as a single string
 */
export const textBufferStringAtom = atom<string>((get) => {
	const state = get(textBufferStateAtom)
	return state.lines.join("\n")
})

/**
 * Get the lines array
 */
export const textBufferLinesAtom = atom<string[]>((get) => {
	const state = get(textBufferStateAtom)
	return [...state.lines]
})

/**
 * Get the cursor position
 */
export const textBufferCursorAtom = atom<CursorPosition>((get) => {
	const state = get(textBufferStateAtom)
	return { ...state.cursor }
})

/**
 * Get the current line text
 */
export const textBufferCurrentLineAtom = atom<string>((get) => {
	const state = get(textBufferStateAtom)
	return state.lines[state.cursor.row] || ""
})

/**
 * Get the line count
 */
export const textBufferLineCountAtom = atom<number>((get) => {
	const state = get(textBufferStateAtom)
	return state.lines.length
})

/**
 * Check if buffer is empty
 */
export const textBufferIsEmptyAtom = atom<boolean>((get) => {
	const state = get(textBufferStateAtom)
	return state.lines.length === 1 && state.lines[0] === ""
})

// ============================================================================
// Action Atoms - Cursor Movement
// ============================================================================

/**
 * Move cursor up one line
 */
export const moveUpAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	if (state.cursor.row > 0) {
		const newRow = state.cursor.row - 1
		const line = state.lines[newRow]
		const newColumn = line !== undefined ? Math.min(state.cursor.column, line.length) : 0
		set(textBufferStateAtom, {
			...state,
			cursor: { row: newRow, column: newColumn },
		})
		return true
	}
	return false
})

/**
 * Move cursor down one line
 */
export const moveDownAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	if (state.cursor.row < state.lines.length - 1) {
		const newRow = state.cursor.row + 1
		const line = state.lines[newRow]
		const newColumn = line !== undefined ? Math.min(state.cursor.column, line.length) : 0
		set(textBufferStateAtom, {
			...state,
			cursor: { row: newRow, column: newColumn },
		})
		return true
	}
	return false
})

/**
 * Move cursor left one character
 */
export const moveLeftAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	if (state.cursor.column > 0) {
		set(textBufferStateAtom, {
			...state,
			cursor: { row: state.cursor.row, column: state.cursor.column - 1 },
		})
		return true
	} else if (state.cursor.row > 0) {
		// Move to end of previous line
		const newRow = state.cursor.row - 1
		const line = state.lines[newRow]
		const newColumn = line ? line.length : 0
		set(textBufferStateAtom, {
			...state,
			cursor: { row: newRow, column: newColumn },
		})
		return true
	}
	return false
})

/**
 * Move cursor right one character
 */
export const moveRightAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const currentLine = state.lines[state.cursor.row]
	const currentLineLength = currentLine ? currentLine.length : 0

	if (state.cursor.column < currentLineLength) {
		set(textBufferStateAtom, {
			...state,
			cursor: { row: state.cursor.row, column: state.cursor.column + 1 },
		})
		return true
	} else if (state.cursor.row < state.lines.length - 1) {
		// Move to start of next line
		set(textBufferStateAtom, {
			...state,
			cursor: { row: state.cursor.row + 1, column: 0 },
		})
		return true
	}
	return false
})

/**
 * Move cursor to start of current line
 */
export const moveToLineStartAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	set(textBufferStateAtom, {
		...state,
		cursor: { row: state.cursor.row, column: 0 },
	})
})

/**
 * Move cursor to end of current line
 */
export const moveToLineEndAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const line = state.lines[state.cursor.row]
	const newColumn = line ? line.length : 0
	set(textBufferStateAtom, {
		...state,
		cursor: { row: state.cursor.row, column: newColumn },
	})
})

/**
 * Move cursor to start of buffer
 */
export const moveToStartAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	set(textBufferStateAtom, {
		...state,
		cursor: { row: 0, column: 0 },
	})
})

/**
 * Move cursor to end of buffer
 */
export const moveToEndAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const lastRow = state.lines.length - 1
	const lastLine = state.lines[lastRow]
	const lastColumn = lastLine ? lastLine.length : 0
	set(textBufferStateAtom, {
		...state,
		cursor: { row: lastRow, column: lastColumn },
	})
})

/**
 * Move cursor to specific position
 */
export const moveToAtom = atom(null, (get, set, position: { row: number; column: number }) => {
	const state = get(textBufferStateAtom)
	const newRow = Math.max(0, Math.min(position.row, state.lines.length - 1))
	const line = state.lines[newRow]
	const newColumn = Math.max(0, Math.min(position.column, line ? line.length : 0))
	set(textBufferStateAtom, {
		...state,
		cursor: { row: newRow, column: newColumn },
	})
})

/**
 * Move cursor to start of previous word
 */
export const moveToPreviousWordAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	let { row, column } = state.cursor

	if (row === 0 && column === 0) {
		return false
	}

	// If starting at col 0, move to end of previous line
	if (column === 0) {
		row--
		column = (state.lines[row] || "").length
		// Now cursor is at the end of the previous line.
		// We will continue to find the word from here.
	} else {
		column-- // Move one char left to start processing
	}

	// Step 1: Skip any whitespace backwards
	while (true) {
		const line = state.lines[row] || ""
		if (column < 0) {
			// Reached start of line, need to go to previous line
			if (row === 0) break // Cannot go further back
			row--
			column = (state.lines[row] || "").length - 1 // Start from end of previous line, minus 1 for loop condition
		}
		if (line[column] === " ") {
			column--
		} else {
			break // Found non-whitespace
		}
	}
	// Now column is at -1 or at the last char of a non-whitespace sequence

	// Step 2: Skip over the word characters backwards
	while (true) {
		const line = state.lines[row] || ""
		if (column < 0) {
			// Reached start of line, need to go to previous line
			if (row === 0) break // Cannot go further back
			row--
			column = (state.lines[row] || "").length - 1 // Start from end of previous line, minus 1
		}
		if (line[column] !== " ") {
			// Is a word character
			column--
		} else {
			break // Found whitespace, which is the word boundary
		}
	}
	// column is now at -1 or at a space before the word.

	column = Math.max(0, column + 1) // Adjust to land at the start of the word.

	set(textBufferStateAtom, { ...state, cursor: { row, column } })
	return true
})

/**
 * Move cursor to start of next word
 */
export const moveToNextWordAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const { row, column } = state.cursor
	const line = state.lines[row] || ""

	if (column === line.length) {
		if (row < state.lines.length - 1) {
			set(textBufferStateAtom, { ...state, cursor: { row: row + 1, column: 0 } })
		}
		return true
	}

	let pos = column

	// Skip current word's characters
	while (pos < line.length && line[pos] !== " ") {
		pos++
	}

	// Skip whitespace
	while (pos < line.length && line[pos] === " ") {
		pos++
	}

	set(textBufferStateAtom, { ...state, cursor: { row, column: pos } })
	return true
})

// ============================================================================
// Action Atoms - Text Editing
// ============================================================================

/**
 * Insert a single character at cursor position
 */
export const insertCharAtom = atom(null, (get, set, char: string) => {
	if (char === "\n") {
		set(insertNewlineAtom)
		return
	}

	const state = get(textBufferStateAtom)
	const line = state.lines[state.cursor.row]
	if (line !== undefined) {
		const newLines = [...state.lines]
		newLines[state.cursor.row] = line.slice(0, state.cursor.column) + char + line.slice(state.cursor.column)
		set(textBufferStateAtom, {
			lines: newLines,
			cursor: { row: state.cursor.row, column: state.cursor.column + 1 },
		})
	}
})

/**
 * Insert text at cursor position (can be multiline)
 */
export const insertTextAtom = atom(null, (get, set, text: string) => {
	if (!text) return

	const state = get(textBufferStateAtom)
	const lines = text.split("\n")

	if (lines.length === 1) {
		// Single line insert
		const line = state.lines[state.cursor.row]
		if (line !== undefined) {
			const newLines = [...state.lines]
			newLines[state.cursor.row] = line.slice(0, state.cursor.column) + text + line.slice(state.cursor.column)
			set(textBufferStateAtom, {
				lines: newLines,
				cursor: { row: state.cursor.row, column: state.cursor.column + text.length },
			})
		}
	} else {
		// Multiline insert
		const currentLine = state.lines[state.cursor.row] || ""
		const beforeCursor = currentLine.slice(0, state.cursor.column)
		const afterCursor = currentLine.slice(state.cursor.column)

		const newLines = [...state.lines]
		const firstLine = lines[0]

		// First line combines with text before cursor
		if (firstLine !== undefined) {
			newLines[state.cursor.row] = beforeCursor + firstLine
		}

		// Insert middle lines
		for (let i = 1; i < lines.length - 1; i++) {
			const middleLine = lines[i]
			if (middleLine !== undefined) {
				newLines.splice(state.cursor.row + i, 0, middleLine)
			}
		}

		// Last line combines with text after cursor
		const lastLine = lines[lines.length - 1]
		if (lines.length > 1 && lastLine !== undefined) {
			newLines.splice(state.cursor.row + lines.length - 1, 0, lastLine + afterCursor)
		}

		const newRow = state.cursor.row + lines.length - 1
		const newColumn = lastLine ? lastLine.length : 0

		set(textBufferStateAtom, {
			lines: newLines,
			cursor: { row: newRow, column: newColumn },
		})
	}
})

/**
 * Insert a newline at cursor position
 */
export const insertNewlineAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const currentLine = state.lines[state.cursor.row] || ""
	const beforeCursor = currentLine.slice(0, state.cursor.column)
	const afterCursor = currentLine.slice(state.cursor.column)

	const newLines = [...state.lines]
	newLines[state.cursor.row] = beforeCursor
	newLines.splice(state.cursor.row + 1, 0, afterCursor)

	set(textBufferStateAtom, {
		lines: newLines,
		cursor: { row: state.cursor.row + 1, column: 0 },
	})
})

/**
 * Delete character before cursor (backspace)
 */
export const backspaceAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)

	if (state.cursor.column > 0) {
		// Delete character before cursor
		const line = state.lines[state.cursor.row]
		if (line !== undefined) {
			const newLines = [...state.lines]
			newLines[state.cursor.row] = line.slice(0, state.cursor.column - 1) + line.slice(state.cursor.column)
			set(textBufferStateAtom, {
				lines: newLines,
				cursor: { row: state.cursor.row, column: state.cursor.column - 1 },
			})
		}
		return true
	} else if (state.cursor.row > 0) {
		// Join with previous line
		const currentLine = state.lines[state.cursor.row] || ""
		const previousLine = state.lines[state.cursor.row - 1] || ""
		const newColumn = previousLine.length

		const newLines = [...state.lines]
		newLines[state.cursor.row - 1] = previousLine + currentLine
		newLines.splice(state.cursor.row, 1)

		set(textBufferStateAtom, {
			lines: newLines,
			cursor: { row: state.cursor.row - 1, column: newColumn },
		})
		return true
	}
	return false
})

/**
 * Delete character at cursor position
 */
export const deleteCharAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const currentLine = state.lines[state.cursor.row] || ""

	if (state.cursor.column < currentLine.length) {
		// Delete character at cursor
		const newLines = [...state.lines]
		newLines[state.cursor.row] =
			currentLine.slice(0, state.cursor.column) + currentLine.slice(state.cursor.column + 1)
		set(textBufferStateAtom, {
			...state,
			lines: newLines,
		})
		return true
	} else if (state.cursor.row < state.lines.length - 1) {
		// Join with next line
		const nextLine = state.lines[state.cursor.row + 1] || ""
		const newLines = [...state.lines]
		newLines[state.cursor.row] = currentLine + nextLine
		newLines.splice(state.cursor.row + 1, 1)
		set(textBufferStateAtom, {
			...state,
			lines: newLines,
		})
		return true
	}
	return false
})

/**
 * Delete word before cursor
 */
export const deleteWordAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const line = state.lines[state.cursor.row]
	if (!line) return

	let startPos = state.cursor.column

	// If we're at the start of the line, do backspace instead
	if (startPos === 0) {
		set(backspaceAtom)
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

	const newLines = [...state.lines]
	newLines[state.cursor.row] = line.slice(0, startPos) + line.slice(state.cursor.column)

	set(textBufferStateAtom, {
		lines: newLines,
		cursor: { row: state.cursor.row, column: startPos },
	})
})

/**
 * Kill (delete) from cursor to end of line
 */
export const killLineAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const line = state.lines[state.cursor.row]
	if (line !== undefined) {
		const newLines = [...state.lines]
		newLines[state.cursor.row] = line.slice(0, state.cursor.column)
		set(textBufferStateAtom, {
			...state,
			lines: newLines,
		})
	}
})

/**
 * Kill (delete) from start of line to cursor
 */
export const killLineLeftAtom = atom(null, (get, set) => {
	const state = get(textBufferStateAtom)
	const line = state.lines[state.cursor.row]
	if (line !== undefined) {
		const newLines = [...state.lines]
		newLines[state.cursor.row] = line.slice(state.cursor.column)
		set(textBufferStateAtom, {
			lines: newLines,
			cursor: { row: state.cursor.row, column: 0 },
		})
	}
})

// ============================================================================
// Action Atoms - Utility
// ============================================================================

/**
 * Set the entire text content
 */
export const setTextAtom = atom(null, (get, set, text: string) => {
	const lines = text ? text.split("\n") : [""]
	const lastRow = lines.length - 1
	const lastLine = lines[lastRow]
	const lastColumn = lastLine ? lastLine.length : 0

	set(textBufferStateAtom, {
		lines,
		cursor: { row: lastRow, column: lastColumn },
	})
})

/**
 * Clear the buffer
 */
export const clearTextAtom = atom(null, (get, set) => {
	set(textBufferStateAtom, {
		lines: [""],
		cursor: { row: 0, column: 0 },
	})
})

// ============================================================================
// Visual Rendering Helpers
// ============================================================================

/**
 * Get visual lines with word wrapping
 */
export const getVisualLinesAtom = atom(null, (get, set, params: { width: number; maxLines?: number }): VisualLine[] => {
	const { width, maxLines } = params
	if (width <= 0) return []

	const state = get(textBufferStateAtom)
	const visualLines: VisualLine[] = []

	for (let rowIndex = 0; rowIndex < state.lines.length; rowIndex++) {
		const line = state.lines[rowIndex]

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

		// Simple character-based wrapping
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
})

/**
 * Get the visual cursor position accounting for line wrapping
 */
export const getVisualCursorAtom = atom(null, (get, set, width: number): CursorPosition => {
	if (width <= 0) return { row: 0, column: 0 }

	const state = get(textBufferStateAtom)
	let visualRow = 0

	// Count visual rows before cursor row
	for (let row = 0; row < state.cursor.row; row++) {
		const line = state.lines[row]
		const lineLength = line ? line.length : 1
		visualRow += Math.ceil(lineLength / width)
	}

	// Add visual rows for current line up to cursor
	const wrappedRows = Math.floor(state.cursor.column / width)
	visualRow += wrappedRows

	const visualColumn = state.cursor.column % width

	return { row: visualRow, column: visualColumn }
})
