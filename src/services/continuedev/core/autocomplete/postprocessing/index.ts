import {
	isBlank,
	isExtremeRepetition,
	isOnlyWhitespace,
	removeBackticks,
	removePrefixOverlap,
	rewritesLineAbove,
} from "../../../../ghost/utils/text-utils.js"

export function postprocessCompletion({
	completion,
	llm,
	prefix,
	suffix,
}: {
	completion: string
	llm: { model: string }
	prefix: string
	suffix: string
}): string | undefined {
	// Don't return empty
	if (isBlank(completion)) {
		return undefined
	}

	// Don't return whitespace
	if (isOnlyWhitespace(completion)) {
		return undefined
	}

	// Dont return if it's just a repeat of the line above
	if (rewritesLineAbove(completion, prefix)) {
		return undefined
	}

	// Filter out repetitions of many lines in a row
	if (isExtremeRepetition(completion)) {
		return undefined
	}

	if (llm.model.includes("codestral")) {
		// Codestral sometimes starts with an extra space
		if (completion[0] === " " && completion[1] !== " ") {
			if (prefix.endsWith(" ") && suffix.startsWith("\n")) {
				completion = completion.slice(1)
			}
		}

		// When there is no suffix, Codestral tends to begin with a new line
		// We do this to avoid double new lines
		if (suffix.length === 0 && prefix.endsWith("\n\n") && completion.startsWith("\n")) {
			// Remove a single leading \n from the completion
			completion = completion.slice(1)
		}
	}

	if (llm.model.includes("qwen3")) {
		// Qwen3 always starts from special thinking markers, and we don't want them to output these contents
		// Remove all content from "
		completion = completion.replace(/<think>.*?<\/think>/s, "")
		completion = completion.replace(/<\/think>/, "")

		// Remove any number of newline characters at the beginning and end
		completion = completion.replace(/^\n+|\n+$/g, "")
	}

	if (llm.model.includes("mercury") || llm.model.includes("granite")) {
		completion = removePrefixOverlap(completion, prefix)
	}

	// // If completion starts with multiple whitespaces, but the cursor is at the end of the line
	// // then it should probably be on a new line
	if (
		llm.model.includes("mercury") &&
		(completion.startsWith("  ") || completion.startsWith("\t")) &&
		!prefix.endsWith("\n") &&
		(suffix.startsWith("\n") || suffix.trim().length === 0)
	) {
		completion = "\n" + completion
	}

	if ((llm.model.includes("gemini") || llm.model.includes("gemma")) && completion.endsWith("<|file_separator|>")) {
		// "<|file_separator|>" is 18 characters long
		completion = completion.slice(0, -18)
	}

	// If prefix ends with space and so does completion, then remove the space from completion

	if (prefix.endsWith(" ") && completion.startsWith(" ")) {
		completion = completion.slice(1)
	}

	// Remove markdown code block delimiters
	completion = removeBackticks(completion)

	return completion
}
