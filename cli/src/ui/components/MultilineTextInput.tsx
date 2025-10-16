import React, { useMemo } from "react"
import { Box, Text } from "ink"
import chalk from "chalk"
import { useAtomValue, useSetAtom } from "jotai"
import { useTheme } from "../../state/hooks/useTheme.js"
import { textBufferAtom, cursorPositionAtom } from "../../state/atoms/ui.js"

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

	// Global state - buffer is the single source of truth
	const buffer = useAtomValue(textBufferAtom)

	// Calculate scroll offset to keep cursor in view
	const scrollOffset = useMemo(() => {
		const visualLines = buffer.getVisualLines(width)
		const cursorRow = buffer.cursor.row

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
	}, [buffer, width, maxLines])

	// Get viewport for rendering
	const viewport = useMemo(() => {
		return buffer.getViewport(width, maxLines, scrollOffset)
	}, [buffer, width, maxLines, scrollOffset])

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
