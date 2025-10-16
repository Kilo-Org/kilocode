import { useStdout } from "ink"
import { useEffect, useState } from "react"

/**
 * Hook to track terminal size and trigger re-renders on resize
 * Returns the current terminal dimensions
 */
export function useTerminalResize(): { columns: number; rows: number } {
	const { stdout } = useStdout()
	const [size, setSize] = useState({
		columns: stdout.columns || 80,
		rows: stdout.rows || 24,
	})

	useEffect(() => {
		function updateSize() {
			setSize({
				columns: stdout.columns || 80,
				rows: stdout.rows || 24,
			})
		}

		stdout.on("resize", updateSize)

		return () => {
			stdout.off("resize", updateSize)
		}
	}, [])

	return size
}
