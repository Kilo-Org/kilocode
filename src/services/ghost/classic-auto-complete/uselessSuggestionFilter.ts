import { postprocessCompletion } from "../../continuedev/core/autocomplete/postprocessing/index.js"

export type AutocompleteSuggestion = {
	suggestion: string
	prefix: string
	suffix: string
}

export function suggestionConsideredDuplication(params: AutocompleteSuggestion): boolean {
	if (DuplicatesFromPrefixOrSuffix(params)) {
		return true
	}

	// Multiline completions can be "partially duplicated": e.g. the first suggested line
	// repeats the last complete line in the prefix, or the last suggested line repeats
	// the first line in the suffix. Those are still considered duplication.
	if (DuplicatesFromEdgeLines(params)) {
		return true
	}

	// When the suggestion isn't a full line or set of lines, normalize by including
	// the rest of the line in the prefix/suffix and check with the completed line(s)
	const normalized = normalizeToCompleteLine(params)
	return !!normalized && (DuplicatesFromPrefixOrSuffix(normalized) || DuplicatesFromEdgeLines(normalized))
}

function DuplicatesFromPrefixOrSuffix(params: AutocompleteSuggestion): boolean {
	const trimmed = params.suggestion.trim()

	return (
		trimmed.length === 0 ||
		params.prefix.trimEnd().endsWith(trimmed) ||
		params.suffix.trimStart().startsWith(trimmed)
	)
}

function DuplicatesFromEdgeLines(params: AutocompleteSuggestion): boolean {
	const trimmedSuggestion = params.suggestion.trim()
	if (!trimmedSuggestion.includes("\n")) {
		return false
	}

	const suggestionLines = trimmedSuggestion.split("\n")
	const firstSuggestionLine = suggestionLines[0]?.trim() ?? ""
	const lastSuggestionLine = suggestionLines[suggestionLines.length - 1]?.trim() ?? ""

	const prefixLastLine = params.prefix.trimEnd().split("\n").pop()?.trim() ?? ""
	const suffixFirstLine = params.suffix.trimStart().split("\n")[0]?.trim() ?? ""

	if (firstSuggestionLine.length > 0 && prefixLastLine.length > 0 && firstSuggestionLine === prefixLastLine) {
		return true
	}

	if (lastSuggestionLine.length > 0 && suffixFirstLine.length > 0 && lastSuggestionLine === suffixFirstLine) {
		return true
	}

	return false
}

/**
 * Normalizes partial-line suggestions by expanding them to the full current line:
 * (prefix line tail) + (suggestion first line) + (suffix line head).
 *
 * Returns null when the suggestion already starts/ends on line boundaries.
 */
function normalizeToCompleteLine(params: AutocompleteSuggestion): AutocompleteSuggestion | null {
	const prefixNewlineIndex = params.prefix.lastIndexOf("\n")
	const prefix = prefixNewlineIndex === -1 ? "" : params.prefix.slice(0, prefixNewlineIndex + 1)
	const prefixLineTail = prefixNewlineIndex === -1 ? params.prefix : params.prefix.slice(prefixNewlineIndex + 1)

	const suffixNewlineIndex = params.suffix.indexOf("\n")
	const suffixLineHead = suffixNewlineIndex === -1 ? params.suffix : params.suffix.slice(0, suffixNewlineIndex)
	const suffix = suffixNewlineIndex === -1 ? "" : params.suffix.slice(suffixNewlineIndex)

	if (prefixLineTail.length === 0 && suffixLineHead.length === 0) {
		return null
	}

	return {
		prefix,
		suggestion: prefixLineTail + params.suggestion + suffixLineHead,
		suffix,
	}
}

/**
 * Postprocesses a Ghost autocomplete suggestion using the continuedev postprocessing pipeline
 * and applies some of our own duplicate checks.
 *
 * @param params - Object containing suggestion parameters
 * @param params.suggestion - The suggested text to insert
 * @param params.prefix - The text before the cursor position
 * @param params.suffix - The text after the cursor position
 * @param params.model - The model string (e.g., "codestral", "qwen3", etc.)
 * @returns The processed suggestion text, or undefined if it should be filtered out
 */
export function postprocessGhostSuggestion(
	params: AutocompleteSuggestion & {
		model: string
	},
): string | undefined {
	// First, run through the continuedev postprocessing pipeline
	const processedSuggestion = postprocessCompletion({
		completion: params.suggestion,
		llm: { model: params.model },
		prefix: params.prefix,
		suffix: params.suffix,
	})

	if (processedSuggestion === undefined) {
		return undefined
	}

	if (
		suggestionConsideredDuplication({
			suggestion: processedSuggestion,
			prefix: params.prefix,
			suffix: params.suffix,
		})
	) {
		return undefined
	}

	return processedSuggestion
}
