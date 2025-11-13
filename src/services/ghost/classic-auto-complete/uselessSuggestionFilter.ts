import { postprocessCompletion } from "../../continuedev/core/autocomplete/postprocessing/index.js"

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
export function postprocessGhostSuggestion(params: {
	suggestion: string
	prefix: string
	suffix: string
	model: string
}): string | undefined {
	const { suggestion, prefix, suffix, model } = params

	// First, run through the continuedev postprocessing pipeline
	const processed = postprocessCompletion({
		completion: suggestion,
		llm: { model },
		prefix,
		suffix,
	})

	if (processed === undefined) {
		return undefined
	}

	const trimmed = processed.trim()

	if (trimmed.length === 0) {
		return undefined
	}

	const trimmedPrefixEnd = prefix.trimEnd()
	if (trimmedPrefixEnd.endsWith(trimmed)) {
		return undefined
	}

	const trimmedSuffix = suffix.trimStart()
	if (trimmedSuffix.startsWith(trimmed)) {
		return undefined
	}

	return processed
}
