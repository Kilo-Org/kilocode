/**
 * MultilineTextInput Component
 *
 * A multi-line text input for Ink CLI applications.
 * Based on ink-multiline-input but simplified for our needs.
 *
 * Key behaviors:
 * - Option+Enter (macOS) / Alt+Enter: Add new line (works reliably)
 * - Shift+Enter: Add new line (requires terminal support for kitty keyboard protocol)
 * - Enter: Submit
 * - Backspace at start of line: Merge with previous line
 * - Escape: Clear all lines
 * - Arrow keys: Navigate within and between lines
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Box, Text, useInput, type Key } from "ink"

import { isGlobalInputSequence } from "@/lib/utils/input.js"

export interface MultilineTextInputProps {
	/**
	 * Current value (can contain newlines)
	 */
	value: string
	/**
	 * Called when the value changes
	 */
	onChange: (value: string) => void
	/**
	 * Called when user submits (Enter)
	 */
	onSubmit?: (value: string) => void
	/**
	 * Called when user presses Escape
	 */
	onEscape?: () => void
	/**
	 * Called when up arrow is pressed while cursor is on the first line
	 * Use this to trigger history navigation
	 */
	onUpAtFirstLine?: () => void
	/**
	 * Called when down arrow is pressed while cursor is on the last line
	 * Use this to trigger history navigation
	 */
	onDownAtLastLine?: () => void
	/**
	 * Placeholder text when empty
	 */
	placeholder?: string
	/**
	 * Whether the input is active/focused
	 */
	isActive?: boolean
	/**
	 * Whether to show the cursor
	 */
	showCursor?: boolean
	/**
	 * Prompt character for the first line
	 */
	prompt?: string
	/**
	 * Terminal width in columns - used for proper line wrapping
	 * If not provided, lines won't be wrapped
	 */
	columns?: number
}

/**
 * Normalize line endings to LF (\n)
 */
function normalizeLineEndings(text: string): string {
	if (text == null) return ""
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * Calculate line and column position from cursor index
 */
function getCursorPosition(value: string, cursorIndex: number): { line: number; col: number } {
	const lines = value.split("\n")
	let pos = 0
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		const lineEnd = pos + line.length
		if (cursorIndex <= lineEnd) {
			return { line: i, col: cursorIndex - pos }
		}
		pos = lineEnd + 1 // +1 for newline
	}
	// Cursor at very end
	return { line: lines.length - 1, col: (lines[lines.length - 1] || "").length }
}

/**
 * Calculate cursor index from line and column position
 */
function getIndexFromPosition(value: string, line: number, col: number): number {
	const lines = value.split("\n")
	let index = 0
	for (let i = 0; i < line && i < lines.length; i++) {
		index += lines[i]!.length + 1 // +1 for newline
	}
	const targetLine = lines[line] || ""
	index += Math.min(col, targetLine.length)
	return index
}

/**
 * Represents a visual row after wrapping a logical line
 */
interface VisualRow {
	text: string
	logicalLineIndex: number
	isFirstRowOfLine: boolean
	startCol: number // column offset in the logical line
}

/**
 * Wrap a logical line into visual rows based on available width.
 * Uses word-boundary wrapping: prefers to break at spaces rather than
 * in the middle of words.
 */
function wrapLine(lineText: string, logicalLineIndex: number, availableWidth: number): VisualRow[] {
	if (availableWidth <= 0 || lineText.length < availableWidth) {
		return [
			{
				text: lineText,
				logicalLineIndex,
				isFirstRowOfLine: true,
				startCol: 0,
			},
		]
	}

	const rows: VisualRow[] = []
	let remaining = lineText
	let startCol = 0
	let isFirst = true

	while (remaining.length > 0) {
		if (remaining.length < availableWidth) {
			// Remaining text fits in one row
			rows.push({
				text: remaining,
				logicalLineIndex,
				isFirstRowOfLine: isFirst,
				startCol,
			})
			break
		}

		// Find a good break point - prefer breaking at a space
		let breakPoint = availableWidth

		// Look backwards from availableWidth for a space
		const searchStart = Math.min(availableWidth, remaining.length)
		let spaceIndex = -1
		for (let i = searchStart - 1; i >= 0; i--) {
			if (remaining[i] === " ") {
				spaceIndex = i
				break
			}
		}

		if (spaceIndex > 0) {
			// Found a space - break after it (include the space in this row)
			breakPoint = spaceIndex + 1
		}
		// else: no space found, break at availableWidth (mid-word break as fallback)

		const chunk = remaining.slice(0, breakPoint)
		rows.push({
			text: chunk,
			logicalLineIndex,
			isFirstRowOfLine: isFirst,
			startCol,
		})

		remaining = remaining.slice(breakPoint)
		startCol += breakPoint
		isFirst = false
	}

	return rows
}

export function MultilineTextInput({
	value,
	onChange,
	onSubmit,
	onEscape,
	onUpAtFirstLine,
	onDownAtLastLine,
	placeholder = "",
	isActive = true,
	showCursor = true,
	prompt = "> ",
	columns,
}: MultilineTextInputProps) {
	const [cursorIndex, setCursorIndex] = useState(value.length)

	// Use refs to track the latest values for use in the useInput callback.
	// This prevents stale closure issues when multiple keystrokes arrive
	// faster than React can re-render.
	const valueRef = useRef(value)
	const cursorIndexRef = useRef(cursorIndex)

	// Track the previous value prop to detect actual changes from the parent
	const prevValuePropRef = useRef(value)

	// Only sync valueRef when the value prop actually changes from the parent.
	// This prevents overwriting our optimistic updates during re-renders
	// triggered by internal state changes (like setCursorIndex) before the
	// parent has processed our onChange call.
	if (value !== prevValuePropRef.current) {
		valueRef.current = value
		prevValuePropRef.current = value
	}
	// cursorIndex is internal state, safe to sync on every render
	cursorIndexRef.current = cursorIndex

	// Clamp cursor if value changes externally
	useEffect(() => {
		if (cursorIndex > value.length) {
			setCursorIndex(value.length)
		}
	}, [value, cursorIndex])

	// Handle keyboard input
	useInput(
		(input: string, key: Key) => {
			// Read from refs to get the latest values, not stale closure captures
			const currentValue = valueRef.current
			const currentCursorIndex = cursorIndexRef.current

			// Escape: clear all
			if (key.escape) {
				onEscape?.()
				return
			}

			// Ignore inputs that are handled at the App level (global shortcuts)
			// This includes Ctrl+C (exit), Ctrl+M (mode toggle), etc.
			if (isGlobalInputSequence(input, key)) {
				return
			}

			// Option+Enter (macOS) / Alt+Enter / Shift+Enter: add new line
			// When Option/Alt is held, the terminal sends \r but key.return is false.
			// This allows us to distinguish it from a regular Enter.
			// Also support various terminal encodings for Shift+Enter.
			const isModifiedEnter =
				(input === "\r" && !key.return) || // Option+Enter on macOS sends \r but key.return=false
				(key.return && key.shift) || // Shift+Enter if terminal reports modifiers
				input === "\x1b[13;2u" || // CSI u encoding for Shift+Enter
				input === "\x1b[27;2;13~" || // xterm modifyOtherKeys encoding for Shift+Enter
				input === "\x1b\r" || // Some terminals send ESC+CR for Shift+Enter
				input === "\x1bOM" || // Some terminals
				(input.startsWith("\x1b[") && input.includes(";2") && input.endsWith("u")) // General CSI u with shift modifier

			if (isModifiedEnter) {
				const newValue =
					currentValue.slice(0, currentCursorIndex) + "\n" + currentValue.slice(currentCursorIndex)
				const newCursorIndex = currentCursorIndex + 1
				// Update refs immediately for next keystroke
				valueRef.current = newValue
				cursorIndexRef.current = newCursorIndex
				onChange(newValue)
				setCursorIndex(newCursorIndex)
				return
			}

			// Enter: submit
			if (key.return) {
				onSubmit?.(currentValue)
				return
			}

			// Tab: ignore for now
			if (key.tab) {
				return
			}

			// Arrow up: move cursor up one line, or trigger history if on first line
			if (key.upArrow) {
				if (!showCursor) return
				const lines = currentValue.split("\n")
				const { line, col } = getCursorPosition(currentValue, currentCursorIndex)

				if (line > 0) {
					// Move to previous line
					const targetLine = lines[line - 1]!
					const newCol = Math.min(col, targetLine.length)
					const newCursorIndex = getIndexFromPosition(currentValue, line - 1, newCol)
					cursorIndexRef.current = newCursorIndex
					setCursorIndex(newCursorIndex)
				} else {
					// On first line - trigger history navigation callback
					onUpAtFirstLine?.()
				}
				return
			}

			// Arrow down: move cursor down one line, or trigger history if on last line
			if (key.downArrow) {
				if (!showCursor) return
				const lines = currentValue.split("\n")
				const { line, col } = getCursorPosition(currentValue, currentCursorIndex)

				if (line < lines.length - 1) {
					// Move to next line
					const targetLine = lines[line + 1]!
					const newCol = Math.min(col, targetLine.length)
					const newCursorIndex = getIndexFromPosition(currentValue, line + 1, newCol)
					cursorIndexRef.current = newCursorIndex
					setCursorIndex(newCursorIndex)
				} else {
					// On last line - trigger history navigation callback
					onDownAtLastLine?.()
				}
				return
			}

			// Arrow left: move cursor left
			if (key.leftArrow) {
				if (!showCursor) return
				const newCursorIndex = Math.max(0, currentCursorIndex - 1)
				cursorIndexRef.current = newCursorIndex
				setCursorIndex(newCursorIndex)
				return
			}

			// Arrow right: move cursor right
			if (key.rightArrow) {
				if (!showCursor) return
				const newCursorIndex = Math.min(currentValue.length, currentCursorIndex + 1)
				cursorIndexRef.current = newCursorIndex
				setCursorIndex(newCursorIndex)
				return
			}

			// Backspace/Delete
			if (key.backspace || key.delete) {
				if (currentCursorIndex > 0) {
					const newValue =
						currentValue.slice(0, currentCursorIndex - 1) + currentValue.slice(currentCursorIndex)
					const newCursorIndex = currentCursorIndex - 1
					// Update refs immediately for next keystroke
					valueRef.current = newValue
					cursorIndexRef.current = newCursorIndex
					onChange(newValue)
					setCursorIndex(newCursorIndex)
				}
				return
			}

			// Normal character input
			if (input) {
				const normalized = normalizeLineEndings(input)
				const newValue =
					currentValue.slice(0, currentCursorIndex) + normalized + currentValue.slice(currentCursorIndex)
				const newCursorIndex = currentCursorIndex + normalized.length
				// Update refs immediately for next keystroke
				valueRef.current = newValue
				cursorIndexRef.current = newCursorIndex
				onChange(newValue)
				setCursorIndex(newCursorIndex)
			}
		},
		{ isActive },
	)

	// Split value into lines for rendering
	const lines = useMemo(() => {
		if (!value && !isActive) {
			return [placeholder]
		}
		if (!value) {
			return [""]
		}
		return value.split("\n")
	}, [value, placeholder, isActive])

	// Determine which line and column the cursor is on
	const cursorPosition = useMemo(() => {
		if (!showCursor || !isActive) return null
		return getCursorPosition(value, cursorIndex)
	}, [value, cursorIndex, showCursor, isActive])

	// Calculate visual rows with wrapping
	const visualRows = useMemo(() => {
		const rows: VisualRow[] = []
		const promptLen = prompt.length

		for (let i = 0; i < lines.length; i++) {
			const lineText = lines[i]!
			// All rows use the same prefix width (prompt length) for consistent alignment
			const prefixLen = promptLen
			// Calculate available width for text (terminal width minus prefix)
			// Use a large number if columns is not provided
			const availableWidth = columns ? Math.max(1, columns - prefixLen) : 10000

			const lineRows = wrapLine(lineText, i, availableWidth)
			rows.push(...lineRows)
		}

		return rows
	}, [lines, columns, prompt.length])

	// Render a visual row with optional cursor
	// Uses a two-column flex layout to ensure all text is vertically aligned:
	// - Column 1: Fixed width for the prompt (only shown on first row)
	// - Column 2: Text content
	const renderVisualRow = useCallback(
		(row: VisualRow, rowIndex: number) => {
			const isPlaceholder = !value && !isActive && row.logicalLineIndex === 0
			const promptWidth = prompt.length
			// Only show the prompt on the very first visual row (first row of first line)
			const showPrompt = row.logicalLineIndex === 0 && row.isFirstRowOfLine

			// Check if cursor is on this visual row
			let hasCursor = false
			let cursorColInRow = -1

			if (cursorPosition && cursorPosition.line === row.logicalLineIndex && isActive) {
				const cursorCol = cursorPosition.col
				// Check if cursor falls within this visual row's range
				if (cursorCol >= row.startCol && cursorCol < row.startCol + row.text.length) {
					hasCursor = true
					cursorColInRow = cursorCol - row.startCol
				}
				// Cursor at the end of this row (for the last row of a line)
				else if (cursorCol === row.startCol + row.text.length) {
					// Check if this is the last visual row for this logical line
					const nextRow = visualRows[rowIndex + 1]
					if (!nextRow || nextRow.logicalLineIndex !== row.logicalLineIndex) {
						hasCursor = true
						cursorColInRow = row.text.length
					}
				}
			}

			if (hasCursor) {
				const beforeCursor = row.text.slice(0, cursorColInRow)
				const cursorAtEnd = cursorColInRow >= row.text.length
				const cursorChar = cursorAtEnd ? " " : row.text[cursorColInRow]!
				const afterCursor = cursorAtEnd ? "" : row.text.slice(cursorColInRow + 1)

				// Check if adding cursor space at end would overflow the line width.
				// When cursor is at the end of a max-width row, rendering an extra space
				// would push the content beyond the terminal width, causing visual shift.
				const wouldOverflow =
					columns !== undefined && cursorAtEnd && promptWidth + row.text.length + 1 > columns

				if (wouldOverflow) {
					// Don't add extra space - cursor will appear at start of next row when text wraps
					return (
						<Box key={rowIndex} flexDirection="row">
							<Box width={promptWidth}>{showPrompt && <Text>{prompt}</Text>}</Box>
							<Text>{row.text}</Text>
						</Box>
					)
				}

				return (
					<Box key={rowIndex} flexDirection="row">
						<Box width={promptWidth}>{showPrompt && <Text>{prompt}</Text>}</Box>
						<Text>{beforeCursor}</Text>
						<Text inverse>{cursorChar}</Text>
						<Text>{afterCursor}</Text>
					</Box>
				)
			}

			// For rows without cursor, use a space for empty text to ensure the row has height
			// This fixes the issue where empty newlines don't expand the component height
			const displayText = row.text.length === 0 ? " " : row.text

			return (
				<Box key={rowIndex} flexDirection="row">
					<Box width={promptWidth}>{showPrompt && <Text>{prompt}</Text>}</Box>
					<Text dimColor={isPlaceholder}>{displayText}</Text>
				</Box>
			)
		},
		[prompt, cursorPosition, value, isActive, visualRows, columns],
	)

	return <Box flexDirection="column">{visualRows.map((row, index) => renderVisualRow(row, index))}</Box>
}
