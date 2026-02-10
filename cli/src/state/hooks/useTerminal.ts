import { useAtomValue, useSetAtom } from "jotai"
import { refreshTerminalCounterAtom, messageResetCounterAtom } from "../atoms/ui.js"
import { useCallback, useEffect, useRef } from "react"
import { getTerminalClearSequence } from "../../ui/utils/terminalCapabilities.js"

export function useTerminal(): void {
	const width = useRef(process.stdout.columns)

	const incrementResetCounter = useSetAtom(messageResetCounterAtom)
	const refreshTerminalCounter = useAtomValue(refreshTerminalCounterAtom)

	const clearTerminal = useCallback(() => {
		// Clear the terminal screen and reset cursor position
		// Uses getTerminalClearSequence() which returns:
		// - Windows: \x1b[2J\x1b[H (without \x1b[3J which causes display artifacts)
		// - Unix/Mac: \x1b[2J\x1b[3J\x1b[H (full clear including scrollback)
		process.stdout.write(getTerminalClearSequence())
		// Increment the message reset counter to force re-render of Static component
		incrementResetCounter((prev) => prev + 1)
	}, [incrementResetCounter])

	// Clear terminal when reset counter changes
	useEffect(() => {
		clearTerminal()
	}, [refreshTerminalCounter, clearTerminal])

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

			// Clear the terminal screen and reset cursor position
			// Uses getTerminalClearSequence() which returns:
			// - Windows: \x1b[2J\x1b[H (without \x1b[3J which causes display artifacts)
			// - Unix/Mac: \x1b[2J\x1b[3J\x1b[H (full clear including scrollback)
			process.stdout.write(getTerminalClearSequence())

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
