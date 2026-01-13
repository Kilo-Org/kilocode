// kilocode_change - new file: Visual cursor indicator during voice recording
import React, { useEffect, useState, useRef } from "react"
import { cn } from "@/lib/utils"

interface VoiceRecordingCursorProps {
	textAreaRef: React.RefObject<HTMLTextAreaElement>
	cursorPosition: number
	isVisible: boolean
}

export const VoiceRecordingCursor: React.FC<VoiceRecordingCursorProps> = ({
	textAreaRef,
	cursorPosition,
	isVisible,
}) => {
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
	const cursorRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!isVisible || !textAreaRef.current) {
			setPosition(null)
			return
		}

		const textarea = textAreaRef.current
		const text = textarea.value

		// Create a temporary div to measure text position
		const measureDiv = document.createElement("div")
		const computedStyle = window.getComputedStyle(textarea)

		// Copy textarea styles to measure div
		measureDiv.style.cssText = `
			position: absolute;
			visibility: hidden;
			white-space: pre-wrap;
			word-wrap: break-word;
			font-family: ${computedStyle.fontFamily};
			font-size: ${computedStyle.fontSize};
			font-weight: ${computedStyle.fontWeight};
			line-height: ${computedStyle.lineHeight};
			letter-spacing: ${computedStyle.letterSpacing};
			padding: ${computedStyle.padding};
			border: ${computedStyle.border};
			width: ${textarea.clientWidth}px;
		`

		document.body.appendChild(measureDiv)

		// Insert text up to cursor position
		const textBeforeCursor = text.substring(0, cursorPosition)
		measureDiv.textContent = textBeforeCursor

		// Add a span to measure cursor position
		const cursorSpan = document.createElement("span")
		cursorSpan.textContent = "|"
		measureDiv.appendChild(cursorSpan)

		// Get position relative to the measure div
		const spanRect = cursorSpan.getBoundingClientRect()
		const textareaRect = textarea.getBoundingClientRect()

		// Calculate position relative to textarea
		const top = spanRect.top - textareaRect.top + textarea.scrollTop
		const left = spanRect.left - textareaRect.left + textarea.scrollLeft

		document.body.removeChild(measureDiv)

		setPosition({ top, left })
	}, [textAreaRef, cursorPosition, isVisible])

	if (!isVisible || !position) {
		return null
	}

	return (
		<div
			ref={cursorRef}
			className={cn(
				"absolute pointer-events-none z-50",
				"w-[2px] h-[1.2em]",
				"bg-vscode-editorCursor",
				"animate-[blink_1s_step-end_infinite]",
			)}
			style={{
				top: `${position.top}px`,
				left: `${position.left}px`,
			}}
		/>
	)
}
