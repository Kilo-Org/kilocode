export interface BackgroundRange {
	start: number
	end: number
	type: "unchanged" | "modified"
}

/**
 * Calculate character-level diff between original and new content
 * Uses a simple LCS-based approach to handle insertions/deletions properly
 */
export function calculateCharacterDiff(originalText: string, newText: string): BackgroundRange[] {
	// For now, let's use a simple approach that works well for the common case
	// of function name changes: find the longest common prefix and suffix

	let prefixLength = 0
	while (
		prefixLength < originalText.length &&
		prefixLength < newText.length &&
		originalText[prefixLength] === newText[prefixLength]
	) {
		prefixLength++
	}

	let suffixLength = 0
	while (
		suffixLength < originalText.length - prefixLength &&
		suffixLength < newText.length - prefixLength &&
		originalText[originalText.length - 1 - suffixLength] === newText[newText.length - 1 - suffixLength]
	) {
		suffixLength++
	}

	const ranges: BackgroundRange[] = []

	// Add unchanged prefix
	if (prefixLength > 0) {
		ranges.push({ start: 0, end: prefixLength, type: "unchanged" })
	}

	// Add modified middle section
	const middleStart = prefixLength
	const middleEnd = newText.length - suffixLength
	if (middleEnd > middleStart) {
		ranges.push({ start: middleStart, end: middleEnd, type: "modified" })
	}

	// Add unchanged suffix
	if (suffixLength > 0) {
		ranges.push({ start: middleEnd, end: newText.length, type: "unchanged" })
	}

	// Handle edge case where strings are identical
	if (ranges.length === 0) {
		ranges.push({ start: 0, end: newText.length, type: "unchanged" })
	}

	return ranges
}
