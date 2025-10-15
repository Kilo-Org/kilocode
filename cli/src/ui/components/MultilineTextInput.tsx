import React, { useState, useEffect, useRef, useMemo } from "react"
import { Box, Text } from "ink"
import chalk from "chalk"
import { TextBuffer } from "../utils/textBuffer.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { useKeyboard } from "../../state/hooks/useKeyboard.js"
import { HOTKEYS } from "../../constants/keyboard/hotkeys.js"

interface MultilineTextInputProps {
	value: string
	onChange: (value: string) => void
	onSubmit?: () => void
	placeholder?: string
	showCursor?: boolean
	maxLines?: number
	width?: number
	focus?: boolean
	disabled?: boolean
}

export const MultilineTextInput: React.FC<MultilineTextInputProps> = ({
	value,
	onChange,
	onSubmit,
	placeholder = "",
	showCursor = true,
	maxLines = 5,
	width = 50,
	focus = true,
	disabled = false,
}) => {
	// Theme
	const theme = useTheme()

	// Create TextBuffer instance
	const bufferRef = useRef<TextBuffer>(new TextBuffer(value))
	const buffer = bufferRef.current

	// Track scroll position for viewport
	const [scrollOffset, setScrollOffset] = useState(0)
	// Force re-render on cursor movement
	const [, forceUpdate] = useState({})

	// Update buffer when value changes externally
	useEffect(() => {
		if (buffer.text !== value) {
			buffer.setText(value)
			// Auto-scroll to cursor when text changes
			const newScroll = buffer.getScrollToCursor(width, maxLines, scrollOffset)
			setScrollOffset(newScroll)
		}
	}, [value, buffer, width, maxLines, scrollOffset])

	// Handle text changes
	const handleTextChange = () => {
		onChange(buffer.text)
		// Auto-scroll to keep cursor in view
		const newScroll = buffer.getScrollToCursor(width, maxLines, scrollOffset)
		setScrollOffset(newScroll)
	}

	// Handle cursor movement
	const handleCursorMove = () => {
		const newScroll = buffer.getScrollToCursor(width, maxLines, scrollOffset)
		setScrollOffset(newScroll)
		// Force re-render to show new cursor position
		forceUpdate({})
	}

	// Use the new hotkey-based keyboard hook
	useKeyboard(
		{
			hotkeys: [
				// New line handling
				{
					hotkey: HOTKEYS.NEW_LINE,
					handler: () => {
						buffer.insertNewline()
						handleTextChange()
					},
				},
				// Send/submit handling
				{
					hotkey: HOTKEYS.SEND,
					handler: () => {
						onSubmit?.()
					},
				},
				// Navigation keys
				{
					hotkey: HOTKEYS.ARROW_UP,
					handler: () => {
						if (buffer.moveUp()) {
							handleCursorMove()
						}
					},
				},
				{
					hotkey: HOTKEYS.ARROW_DOWN,
					handler: () => {
						if (buffer.moveDown()) {
							handleCursorMove()
						}
					},
				},
				{
					hotkey: HOTKEYS.ARROW_LEFT,
					handler: () => {
						if (buffer.moveLeft()) {
							handleCursorMove()
						}
					},
				},
				{
					hotkey: HOTKEYS.ARROW_RIGHT,
					handler: () => {
						if (buffer.moveRight()) {
							handleCursorMove()
						}
					},
				},
				// Text deletion
				{
					hotkey: HOTKEYS.BACKSPACE,
					handler: () => {
						if (buffer.backspace()) {
							handleTextChange()
						}
					},
				},
				{
					hotkey: HOTKEYS.DELETE,
					handler: () => {
						if (buffer.deleteChar()) {
							handleTextChange()
						}
					},
				},
				{
					hotkey: HOTKEYS.DELETE_WORD,
					handler: () => {
						buffer.deleteWord()
						handleTextChange()
					},
				},
				// Line operations
				{
					hotkey: HOTKEYS.LINE_START,
					handler: () => {
						buffer.moveToLineStart()
						handleCursorMove()
					},
				},
				{
					hotkey: HOTKEYS.LINE_END,
					handler: () => {
						buffer.moveToLineEnd()
						handleCursorMove()
					},
				},
				{
					hotkey: HOTKEYS.KILL_LINE,
					handler: () => {
						buffer.killLine()
						handleTextChange()
					},
				},
				{
					hotkey: HOTKEYS.KILL_LINE_LEFT,
					handler: () => {
						buffer.killLineLeft()
						handleTextChange()
					},
				},
				// Escape to clear
				{
					hotkey: HOTKEYS.ESCAPE,
					handler: () => {
						buffer.clear()
						handleTextChange()
					},
				},
			],
			// Handle regular character input
			onInput: (char) => {
				buffer.insertChar(char)
				handleTextChange()
			},
			// Handle paste events
			onPaste: (pastedText) => {
				buffer.insertText(pastedText)
				handleTextChange()
			},
		},
		{ active: focus && !disabled },
	)

	// Get viewport for rendering - include buffer state in dependencies
	const viewport = useMemo(() => {
		return buffer.getViewport(width, maxLines, scrollOffset)
	}, [buffer, width, maxLines, scrollOffset, value, buffer.cursor.row, buffer.cursor.column])

	// Render placeholder if empty
	if (buffer.isEmpty && placeholder) {
		return (
			<Box flexDirection="column" width={width}>
				<Text color="gray">
					{showCursor && focus ? chalk.inverse(placeholder[0] || " ") + placeholder.slice(1) : placeholder}
				</Text>
			</Box>
		)
	}

	// Render multiline text
	return (
		<Box flexDirection="column" width={width}>
			{viewport.lines.map((visualLine, index) => {
				const isCurrentLine = viewport.cursorInViewport && index === viewport.cursorInViewport.row
				const lineText = visualLine.text

				// Add cursor highlighting if on current line
				if (isCurrentLine && showCursor && focus && viewport.cursorInViewport) {
					const col = viewport.cursorInViewport.column
					const before = lineText.slice(0, col)
					const cursorChar = lineText[col] || " "
					const after = lineText.slice(col + 1)

					return (
						<Box key={index} width={width}>
							<Text>
								{before}
								{chalk.inverse(cursorChar)}
								{after}
								{/* Pad line to full width for consistent rendering */}
								{" ".repeat(Math.max(0, width - lineText.length - 1))}
							</Text>
						</Box>
					)
				}

				// Regular line without cursor
				return (
					<Box key={index} width={width}>
						<Text>
							{lineText}
							{/* Pad line to full width */}
							{" ".repeat(Math.max(0, width - lineText.length))}
						</Text>
					</Box>
				)
			})}

			{/* Scroll indicators - only show when content exceeds maxLines */}
			{buffer.getVisualLines(width).length > maxLines && (
				<Box>
					<Text color={theme.ui.border.active}>
						{scrollOffset > 0 && "↑ "}
						{scrollOffset + maxLines < buffer.getVisualLines(width).length && "↓"}
					</Text>
				</Box>
			)}
		</Box>
	)
}
