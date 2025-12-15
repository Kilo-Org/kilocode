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
 * @param params.multiline - Whether to allow multi-line completions (default: true)
 * @returns The processed suggestion text, or undefined if it should be filtered out
 */
export function postprocessGhostSuggestion(params: {
	suggestion: string
	prefix: string
	suffix: string
	model: string
	multiline?: boolean
}): string | undefined {
	const { suggestion, prefix, suffix, model, multiline = true } = params

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

	// Truncate at first newline for single-line mode
	if (!multiline) {
		const newlineIndex = processed.indexOf("\n")
		if (newlineIndex >= 0) {
			const truncated = processed.slice(0, newlineIndex)
			// Return undefined if truncation results in empty or whitespace-only string
			if (truncated.trim().length === 0) {
				return undefined
			}
			return truncated
		}
	}

	return processed
}
