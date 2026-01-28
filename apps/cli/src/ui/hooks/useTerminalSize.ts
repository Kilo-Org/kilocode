/**
 * useTerminalSize - Hook that tracks terminal dimensions and re-renders on resize
 * Includes debouncing to prevent rendering issues during rapid resizing
 */

import { useState, useEffect, useRef } from "react"

interface TerminalSize {
	columns: number
	rows: number
}

/**
 * Returns the current terminal size and re-renders when it changes
 * Debounces resize events to prevent rendering artifacts
 */
export function useTerminalSize(): TerminalSize {
	// Get initial size synchronously - this is the value used for first render
	const [size, setSize] = useState<TerminalSize>(() => ({
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	}))

	const debounceTimer = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		const handleResize = () => {
			// Clear any pending debounce
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current)
			}

			// Debounce resize events by 50ms
			debounceTimer.current = setTimeout(() => {
				// Clear the terminal before updating size to prevent artifacts
				process.stdout.write("\x1b[2J\x1b[H")

				setSize({
					columns: process.stdout.columns || 80,
					rows: process.stdout.rows || 24,
				})
				debounceTimer.current = null
			}, 50)
		}

		// Listen for resize events
		process.stdout.on("resize", handleResize)

		// Cleanup
		return () => {
			process.stdout.off("resize", handleResize)
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current)
			}
		}
	}, [])

	return size
}
