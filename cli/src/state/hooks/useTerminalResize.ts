/**
 * useTerminalResize - Hook to handle terminal resize events
 *
 * This hook listens for terminal resize events and triggers a full UI re-render
 * by clearing the terminal and incrementing the message reset counter.
 * This is necessary because Ink's Static component doesn't re-render on resize.
 */

import { useCallback, useEffect, useRef } from "react"
import { useSetAtom, useAtomValue } from "jotai"
import { messageResetCounterAtom } from "../atoms/ui.js"
import { themeAtom } from "../atoms/config.js"

/**
 * Hook to handle terminal resize events and theme changes
 * Clears the terminal and forces a full re-render when terminal size changes or theme changes
 */
export function useTerminalResize(): void {
	const incrementResetCounter = useSetAtom(messageResetCounterAtom)
	const width = useRef(process.stdout.columns)
	const currentTheme = useAtomValue(themeAtom)

	const clearTerminal = useCallback(() => {
		// Clear the terminal screen and reset cursor position
		// \x1b[2J - Clear entire screen
		// \x1b[3J - Clear scrollback buffer (needed for gnome-terminal)
		// \x1b[H - Move cursor to home position (0,0)
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

		// Increment reset counter to force Static component remount
		incrementResetCounter((prev) => prev + 1)
	}, [incrementResetCounter])

	// Effect for theme changes
	useEffect(() => {
		clearTerminal()
	}, [currentTheme, clearTerminal])

	// Resize effect
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
			clearTerminal()
		}
		// Listen for resize events
		process.stdout.on("resize", handleResize)

		// Cleanup listener on unmount
		return () => {
			process.stdout.off("resize", handleResize)
		}
	}, [clearTerminal])
}
