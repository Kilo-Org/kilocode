import type { AutocompleteSuggestion } from "../uselessSuggestionFilter"

/**
 * Detects if the cursor is inside a markdown code block.
 */
export function isInsideCodeBlock(prefix: string): boolean {
	// Match code fence patterns: ``` at the start of a line (optionally followed by language)
	// We need to count opening fences and closing fences
	const lines = prefix.split("\n")
	let insideCodeBlock = false

	for (const line of lines) {
		const trimmed = line.trim()
		// A line that starts with ``` toggles the code block state
		if (trimmed.startsWith("```")) {
			insideCodeBlock = !insideCodeBlock
		}
	}

	return insideCodeBlock
}

/**
 * Removes spurious newlines before code block closing fences in suggestions.
 *
 * When inside a code block, LLMs often suggest closing the block with an extra
 * newline before the closing ```. This filter removes that extra newline.
 *
 * Example problem:
 * ```ruby
 * puts 'yo'
 * <suggestion>
 * ```
 *
 * # some heading
 * </suggestion>
 *
 * The suggestion starts with "\n```" but should start with "```" to properly
 * close the code block without adding an extra blank line.
 *
 * @param params - The filter parameters
 * @returns The filtered suggestion
 */
export function removeSpuriousNewlinesBeforeCodeBlockClosingFences(params: AutocompleteSuggestion): string {
	const { suggestion, prefix } = params

	// Only apply this filter when inside a code block
	if (!isInsideCodeBlock(prefix)) {
		return suggestion
	}

	// If the suggestion is about to close the fence, treat leading newlines differently depending on whether the
	// cursor is already at the start of a line (i.e. prefix ends with a newline).
	const startsWithNewlinesThenFence = /^(?:\r?\n)+(?=```)/.test(suggestion)
	if (!startsWithNewlinesThenFence) {
		return suggestion
	}

	const prefixEndsWithNewline = /(?:\r?\n)$/.test(prefix)
	if (prefixEndsWithNewline) {
		// Cursor is already at a fresh line -> remove all leading newlines before the closing fence.
		return suggestion.replace(/^(?:\r?\n)+(?=```)/, "")
	}

	// Cursor is at end of a line -> keep exactly ONE newline before the closing fence.
	return suggestion.replace(/^(\r?\n)(?:\r?\n)+(?=```)/, "$1")
}

type MarkdownSuggestionFilter = (params: AutocompleteSuggestion) => string

const markdownFilters: MarkdownSuggestionFilter[] = [removeSpuriousNewlinesBeforeCodeBlockClosingFences]

export function markdownFilter(params: AutocompleteSuggestion): string {
	return markdownFilters.reduce((suggestion, filter) => filter({ ...params, suggestion }), params.suggestion)
}
