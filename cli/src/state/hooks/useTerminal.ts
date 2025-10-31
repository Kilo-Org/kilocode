import { useAtomValue, useSetAtom } from "jotai"
import { messageResetCounterAtom, messageCutoffTimestampAtom } from "../atoms/ui.js"
import { useCallback, useEffect, useRef } from "react"

export function useTerminal(): void {
	const width = useRef(process.stdout.columns)

	const incrementResetCounter = useSetAtom(messageResetCounterAtom)
	const messageCutoffTimestamp = useAtomValue(messageCutoffTimestampAtom)

	const clearTerminal = useCallback(() => {
		// Clear the terminal screen and reset cursor position
		// \x1b[2J - Clear entire screen
		// \x1b[3J - Clear scrollback buffer (needed for gnome-terminal)
		// \x1b[H - Move cursor to home position (0,0)
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

		// Increment reset counter to force Static component remount
		incrementResetCounter((prev) => prev + 1)
	}, [incrementResetCounter])

	useEffect(() => {
		if (messageCutoffTimestamp !== 0) {
			clearTerminal()
		}
	}, [messageCutoffTimestamp, clearTerminal])

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
