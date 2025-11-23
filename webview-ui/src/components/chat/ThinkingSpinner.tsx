/**
 * ThinkingSpinner - Animated spinner for the thinking state
 * Shows an animated loading spinner with "Thinking..." text
 */

import React, { useEffect, useState } from "react"

interface ThinkingSpinnerProps {
	className?: string
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const ANIMATION_INTERVAL = 80 // ms per frame

/**
 * Displays an animated spinner with "Thinking..." text
 * Uses Braille Unicode characters for smooth animation
 */
export const ThinkingSpinner: React.FC<ThinkingSpinnerProps> = ({ className = "" }) => {
	const [frameIndex, setFrameIndex] = useState(0)

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, ANIMATION_INTERVAL)

		return () => clearInterval(interval)
	}, [])

	return <span className={className}>{SPINNER_FRAMES[frameIndex]} Thinking...</span>
}
