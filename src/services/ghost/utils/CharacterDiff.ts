import { diffChars, diffWords } from "diff"

/**
 * Represents a range of text with highlighting information for diff visualization
 */
export interface BackgroundRange {
	/** Starting position (inclusive) */
	start: number
	/** Ending position (exclusive) */
	end: number
	/** Type of change for this range */
	type: "unchanged" | "added" | "removed" | "modified"
}

/**
 * Calculate text diff with intelligent semantic grouping.
 *
 * Hybrid approach: uses word-level diffing with character-level refinement for small changes.
 * Handles prefix/suffix additions and maintains word boundaries for readability.
 */
export function calculateDiff(originalText: string, newText: string): BackgroundRange[] {
	if (!originalText && !newText) return []
	if (!originalText) return [{ start: 0, end: newText.length, type: "added" }]
	if (!newText) return []

	const wordDiff = diffWords(originalText, newText)
	const ranges: BackgroundRange[] = []
	let currentPosition = 0

	for (let i = 0; i < wordDiff.length; i++) {
		const change = wordDiff[i]

		if (change.added) {
			ranges.push({
				start: currentPosition,
				end: currentPosition + change.value.length,
				type: "added",
			})
			currentPosition += change.value.length
		} else if (change.removed) {
			const nextChange = wordDiff[i + 1]
			if (nextChange?.added) {
				const { ranges: processedRanges, newPosition } = processWordPair(
					change.value,
					nextChange.value,
					currentPosition,
				)
				ranges.push(...processedRanges)
				currentPosition = newPosition
				i++ // Skip the next change since we processed it
			}
			// If removal without following addition, skip (removed content not shown)
		} else {
			ranges.push({
				start: currentPosition,
				end: currentPosition + change.value.length,
				type: "unchanged",
			})
			currentPosition += change.value.length
		}
	}

	return ranges
}

/**
 * Process removal/addition word pair to determine optimal diff strategy.
 */
function processWordPair(
	removedWord: string,
	addedWord: string,
	startPosition: number,
): { ranges: BackgroundRange[]; newPosition: number } {
	// Handle prefix additions: "abc" → "abcd"
	if (addedWord.startsWith(removedWord)) {
		const ranges: BackgroundRange[] = [
			{ start: startPosition, end: startPosition + removedWord.length, type: "unchanged" },
		]

		if (addedWord.length > removedWord.length) {
			ranges.push({
				start: startPosition + removedWord.length,
				end: startPosition + addedWord.length,
				type: "added",
			})
		}

		return { ranges, newPosition: startPosition + addedWord.length }
	}

	// Handle suffix additions: "bcd" → "abcd"
	if (addedWord.endsWith(removedWord)) {
		const prefixLength = addedWord.length - removedWord.length
		const ranges: BackgroundRange[] = []

		if (prefixLength > 0) {
			ranges.push({
				start: startPosition,
				end: startPosition + prefixLength,
				type: "added",
			})
		}

		ranges.push({
			start: startPosition + prefixLength,
			end: startPosition + addedWord.length,
			type: "unchanged",
		})

		return { ranges, newPosition: startPosition + addedWord.length }
	}

	// For small, similar-length words, use character-level refinement
	if (shouldUseCharacterRefinement(removedWord, addedWord)) {
		const ranges = refineWithCharacterDiff(removedWord, addedWord, startPosition)
		return { ranges, newPosition: startPosition + addedWord.length }
	}

	// Large word change - treat as single modification
	const ranges: BackgroundRange[] = [
		{
			start: startPosition,
			end: startPosition + addedWord.length,
			type: "modified",
		},
	]

	return { ranges, newPosition: startPosition + addedWord.length }
}

/**
 * Determine if character-level refinement should be used for small, similar-length words.
 */
function shouldUseCharacterRefinement(word1: string, word2: string): boolean {
	return word1.length <= 10 && word2.length <= 10 && Math.abs(word1.length - word2.length) <= 2
}

/**
 * Refine small word changes using character-level diffing.
 * Shows character-by-character changes for similar words to improve readability.
 */
function refineWithCharacterDiff(originalWord: string, newWord: string, startPosition: number): BackgroundRange[] {
	// For small words with similar lengths, show character-by-character changes
	if (Math.min(originalWord.length, newWord.length) <= 10 && Math.abs(originalWord.length - newWord.length) <= 3) {
		const ranges: BackgroundRange[] = []
		const maxLength = Math.max(originalWord.length, newWord.length)

		for (let i = 0; i < maxLength; i++) {
			const originalChar = originalWord[i] || ""
			const newChar = newWord[i] || ""
			const type = originalChar === newChar ? "unchanged" : "modified"

			ranges.push({
				start: startPosition + i,
				end: startPosition + i + 1,
				type,
			})
		}

		return ranges
	}

	// For larger or very different words, use Myers diff
	const charDiff = diffChars(originalWord, newWord)
	const ranges: BackgroundRange[] = []
	let currentPosition = startPosition

	for (const change of charDiff) {
		if (change.added) {
			ranges.push({
				start: currentPosition,
				end: currentPosition + change.value.length,
				type: "modified",
			})
			currentPosition += change.value.length
		} else if (change.removed) {
			// Skip removed content
		} else {
			ranges.push({
				start: currentPosition,
				end: currentPosition + change.value.length,
				type: "unchanged",
			})
			currentPosition += change.value.length
		}
	}

	return ranges
}
