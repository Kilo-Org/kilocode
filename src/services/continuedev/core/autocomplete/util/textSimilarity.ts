import { distance } from "fastest-levenshtein"

/**
 * Determine if two lines are effectively the same/repetition.
 * Short lines (<=4 chars) are never considered repeated.
 */
export function lineIsRepeated(a: string, b: string): boolean {
	if (a.length <= 4 || b.length <= 4) {
		return false
	}
	const aTrim = a.trim()
	const bTrim = b.trim()
	return distance(aTrim, bTrim) / bTrim.length < 0.1
}
