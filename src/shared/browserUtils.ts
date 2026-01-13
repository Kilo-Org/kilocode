/**
 * Parses coordinate string and scales from image dimensions to viewport dimensions
 * The LLM examines the screenshot it receives (which may be downscaled by the API)
 * and reports coordinates in format: "x,y@widthxheight" where widthxheight is what the LLM observed
 *
 * Format: "x,y@widthxheight" (required)
 * Returns: scaled coordinate string "x,y" in viewport coordinates
 * Throws: Error if format is invalid or missing image dimensions
 */
export function scaleCoordinate(coordinate: string, viewportWidth: number, viewportHeight: number): string {
	// Parse coordinate with required image dimensions (accepts both 'x' and ',' as dimension separators)
	const match = coordinate.match(/^\s*(\d+)\s*,\s*(\d+)\s*@\s*(\d+)\s*[x,]\s*(\d+)\s*$/)

	if (!match) {
		throw new Error(
			`Invalid coordinate format: "${coordinate}". ` +
				`Expected format: "x,y@widthxheight" (e.g., "450,300@1024x768")`,
		)
	}

	const [, xStr, yStr, imgWidthStr, imgHeightStr] = match
	const x = parseInt(xStr, 10)
	const y = parseInt(yStr, 10)
	const imgWidth = parseInt(imgWidthStr, 10)
	const imgHeight = parseInt(imgHeightStr, 10)

	// Scale coordinates from image dimensions to viewport dimensions
	const scaledX = Math.round((x / imgWidth) * viewportWidth)
	const scaledY = Math.round((y / imgHeight) * viewportHeight)

	return `${scaledX},${scaledY}`
}

/**
 * Formats a key string into a more readable format (e.g., "Control+c" -> "Ctrl + C")
 */
export function prettyKey(k?: string): string {
	if (!k) return ""
	return k
		.split("+")
		.map((part) => {
			const p = part.trim()
			const lower = p.toLowerCase()
			const map: Record<string, string> = {
				enter: "Enter",
				tab: "Tab",
				escape: "Esc",
				esc: "Esc",
				backspace: "Backspace",
				space: "Space",
				shift: "Shift",
				control: "Ctrl",
				ctrl: "Ctrl",
				alt: "Alt",
				meta: "Meta",
				command: "Cmd",
				cmd: "Cmd",
				arrowup: "Arrow Up",
				arrowdown: "Arrow Down",
				arrowleft: "Arrow Left",
				arrowright: "Arrow Right",
				pageup: "Page Up",
				pagedown: "Page Down",
				home: "Home",
				end: "End",
			}
			if (map[lower]) return map[lower]
			const keyMatch = /^Key([A-Z])$/.exec(p)
			if (keyMatch) return keyMatch[1].toUpperCase()
			const digitMatch = /^Digit([0-9])$/.exec(p)
			if (digitMatch) return digitMatch[1]
			const spaced = p.replace(/([a-z])([A-Z])/g, "$1 $2")
			return spaced.charAt(0).toUpperCase() + spaced.slice(1)
		})
		.join(" + ")
}

/**
 * Wrapper around scaleCoordinate that handles failures gracefully by checking for simple coordinates
 */
export function getViewportCoordinate(
	coord: string | undefined,
	viewportWidth: number,
	viewportHeight: number,
): string {
	if (!coord) return ""

	try {
		return scaleCoordinate(coord, viewportWidth, viewportHeight)
	} catch (e) {
		// Fallback to simple x,y parsing or return as is
		const simpleMatch = /^\s*(\d+)\s*,\s*(\d+)/.exec(coord)
		return simpleMatch ? `${simpleMatch[1]},${simpleMatch[2]}` : coord
	}
}
