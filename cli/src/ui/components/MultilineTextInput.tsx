import React, { useMemo } from "react"
import { Box, Text } from "ink"
import chalk from "chalk"
import { useAtomValue } from "jotai"
import { useTheme } from "../../state/hooks/useTheme.js"
import { textBufferStateAtom, textBufferIsEmptyAtom, getVisualLinesAtom } from "../../state/atoms/textBuffer.js"
import { useSetAtom } from "jotai"
import stringWidth from "string-width"

interface MultilineTextInputProps {
	placeholder?: string
	showCursor?: boolean
	maxLines?: number
	width?: number
	focus?: boolean
}

export const MultilineTextInput: React.FC<MultilineTextInputProps> = ({
	placeholder = "",
	showCursor = true,
	maxLines = 5,
	width = 50,
	focus = true,
}) => {
	// Theme
	const theme = useTheme()

	// Global state
	const bufferState = useAtomValue(textBufferStateAtom)
	const isEmpty = useAtomValue(textBufferIsEmptyAtom)
	const getVisualLines = useSetAtom(getVisualLinesAtom)

	// Get visual lines
	const visualLines = useMemo(() => {
		return getVisualLines({ width })
	}, [getVisualLines, width, bufferState])

	// Calculate scroll offset to keep cursor in view
	const scrollOffset = useMemo(() => {
		const cursorRow = bufferState.cursor.row

		// If content fits in viewport, no scrolling needed
		if (visualLines.length <= maxLines) {
			return 0
		}

		// Calculate scroll to keep cursor in view
		let offset = 0
		if (cursorRow >= maxLines) {
			offset = cursorRow - maxLines + 1
		}

		return offset
	}, [bufferState.cursor.row, visualLines.length, maxLines])

	// Get viewport for rendering
	const viewport = useMemo(() => {
		const actualScroll = Math.max(0, Math.min(scrollOffset, visualLines.length - maxLines))
		const visibleLines = visualLines.slice(actualScroll, actualScroll + maxLines)

		// Calculate visual cursor position
		let visualRow = 0
		for (let row = 0; row < bufferState.cursor.row; row++) {
			const line = bufferState.lines[row]
			const lineLength = line ? line.length : 1
			visualRow += Math.ceil(lineLength / width)
		}
		const wrappedRows = Math.floor(bufferState.cursor.column / width)
		visualRow += wrappedRows
		const visualColumn = bufferState.cursor.column % width

		// Check if cursor is in viewport
		let cursorInViewport: { row: number; column: number } | null = null
		if (visualRow >= actualScroll && visualRow < actualScroll + maxLines) {
			cursorInViewport = {
				row: visualRow - actualScroll,
				column: visualColumn,
			}
		}

		return {
			lines: visibleLines,
			cursorInViewport,
		}
	}, [visualLines, scrollOffset, maxLines, bufferState, width])

	// Render placeholder if empty
	if (isEmpty && placeholder) {
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

					// Calculate actual display width using string-width
					const displayWidth = stringWidth(before) + stringWidth(cursorChar) + stringWidth(after)
					const paddingNeeded = Math.max(0, width - displayWidth)

					return (
						<Box key={index} width={width}>
							<Text>
								{before}
								{chalk.inverse(cursorChar)}
								{after}
								{/* Pad line to full width for consistent rendering */}
								{" ".repeat(paddingNeeded)}
							</Text>
						</Box>
					)
				}

				// Regular line without cursor
				// Calculate actual display width using string-width
				const displayWidth = stringWidth(lineText)
				const paddingNeeded = Math.max(0, width - displayWidth)

				return (
					<Box key={index} width={width}>
						<Text>
							{lineText}
							{/* Pad line to full width */}
							{" ".repeat(paddingNeeded)}
						</Text>
					</Box>
				)
			})}

			{/* Scroll indicators - only show when content exceeds maxLines */}
			{visualLines.length > maxLines && (
				<Box>
					<Text color={theme.ui.border.active}>
						{scrollOffset > 0 && "↑ "}
						{scrollOffset + maxLines < visualLines.length && "↓"}
					</Text>
				</Box>
			)}
		</Box>
	)
}
