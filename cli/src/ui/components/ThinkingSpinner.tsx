/**
 * ThinkingSpinner - Animated spinner for the thinking state
 * Shows an animated loading spinner with "Thinking..." text
 */

import React, { useEffect, useState } from "react"
import { Text } from "ink"

interface ThinkingSpinnerProps {
	color?: string
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const ANIMATION_INTERVAL = 80 // ms per frame

/**
 * Displays an animated spinner with "Thinking..." text
 * Uses Braille Unicode characters for smooth animation
 */
export const ThinkingSpinner: React.FC<ThinkingSpinnerProps> = ({ color = "gray" }) => {
	const [frameIndex, setFrameIndex] = useState(0)

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, ANIMATION_INTERVAL)

		return () => clearInterval(interval)
	}, [])

	return <Text color={color}>{SPINNER_FRAMES[frameIndex]} Thinking...</Text>
}
