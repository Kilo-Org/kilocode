/**
 * ThinkingAnimation - Animated spinner for "Thinking..." status
 * Uses Braille pattern characters for smooth rotation effect
 */

import React, { useState, useEffect } from "react"
import { Text } from "ink"
import { useTheme } from "../../state/hooks/useTheme.js"

export interface ThinkingAnimationProps {
	/** Optional text to display after the spinner */
	text?: string
}

/**
 * Displays an animated spinner with rotating Braille characters
 *
 * Features:
 * - Smooth rotation using Braille pattern characters
 * - 80ms frame interval for optimal visual appeal
 * - Uses vibrant brand color instead of dimmed text
 * - Proper cleanup to prevent memory leaks
 */
export const ThinkingAnimation: React.FC<ThinkingAnimationProps> = ({ text = "Thinking..." }) => {
	const theme = useTheme()

	// Braille pattern characters that create a smooth circular rotation
	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

	const [frameIndex, setFrameIndex] = useState(0)

	useEffect(() => {
		// Set up interval to cycle through animation frames
		const interval = setInterval(() => {
			setFrameIndex((prevIndex) => (prevIndex + 1) % frames.length)
		}, 80) // 80ms = 12.5 FPS for smooth animation

		// Cleanup interval on unmount
		return () => clearInterval(interval)
	}, [frames.length])

	return (
		<Text color={theme.brand.primary}>
			{frames[frameIndex]} {text}
		</Text>
	)
}
