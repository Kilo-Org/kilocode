/**
 * BrailleSpinner - Animated Braille spinner for loading states
 * Displays an animated loading indicator using Braille Unicode characters
 */

import { useEffect, useState } from "react"

interface BrailleSpinnerProps {
	/** Optional className for styling */
	className?: string
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const ANIMATION_INTERVAL = 80 // ms per frame

/**
 * Displays an animated spinner using Braille Unicode characters
 * Cycles through frames for smooth loading animation
 */
export const BrailleSpinner = ({ className = "" }: BrailleSpinnerProps) => {
	const [frameIndex, setFrameIndex] = useState(0)

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, ANIMATION_INTERVAL)

		return () => clearInterval(interval)
	}, [])

	return <span className={className}>{SPINNER_FRAMES[frameIndex]}</span>
}
