/**
 * useTerminalResize - Hook to handle terminal resize events
 *
 * This hook listens for terminal resize events and triggers a full UI re-render
 * by clearing the terminal and incrementing the message reset counter.
 * This is necessary because Ink's Static component doesn't re-render on resize.
 */

import { useEffect, useRef } from "react"
import { useSetAtom } from "jotai"
import { messageResetCounterAtom } from "../atoms/ui.js"

/**
 * Hook to handle terminal resize events
 * Clears the terminal and forces a full re-render when terminal size changes
 */
export function useTerminalResize(): void {
	const incrementResetCounter = useSetAtom(messageResetCounterAtom)
	const width = useRef(process.stdout.columns)

	useEffect(() => {
		// Only set up resize listener if stdout is a TTY
		if (!process.stdout.isTTY) {
			return
		}

		const handleResize = () => {
			if (process.stdout.columns === width.current) {
				return
			}
			width.current = process.stdout.columns

			// Clear the terminal screen and reset cursor position
			// \x1b[2J - Clear entire screen
			// \x1b[3J - Clear scrollback buffer (needed for gnome-terminal)
			// \x1b[H - Move cursor to home position (0,0)
			process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

			// Increment reset counter to force Static component remount
			incrementResetCounter((prev) => prev + 1)
		}

		// Listen for resize events
		process.stdout.on("resize", handleResize)

		// Cleanup listener on unmount
		return () => {
			process.stdout.off("resize", handleResize)
		}
	}, [incrementResetCounter])
}
