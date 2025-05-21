// PLANREF: continue/core/llm/countTokens.ts

// FIXME: Replace this with actual token counting using js-tiktoken or similar
/**
 * Placeholder for token counting.
 * @param text The text to count tokens for.
 * @param _modelName The model name (currently unused in placeholder).
 * @returns A rough estimate of tokens (currently character length / 4).
 */
export function countTokens(text: string, _modelName?: string): number {
	if (!text) {
		return 0
	}
	// Super rough estimate, replace with actual tokenizer
	return Math.ceil(text.length / 4)
}

/**
 * Prunes lines from the top of a string until it fits within maxTokens.
 * @param prompt The string to prune.
 * @param maxTokens The maximum number of tokens allowed.
 * @param modelName The model name for token counting.
 * @returns The pruned string.
 */
export function pruneLinesFromTop(prompt: string, maxTokens: number, modelName: string): string {
	let totalTokens = countTokens(prompt, modelName)
	const lines = prompt.split("\n")
	while (totalTokens > maxTokens && lines.length > 0) {
		const lineToRemove = lines.shift()
		if (lineToRemove !== undefined) {
			totalTokens -= countTokens(lineToRemove, modelName)
			if (lines.length > 0) {
				// Also account for the newline character removed
				totalTokens -= countTokens("\n", modelName)
			}
		}
	}
	return lines.join("\n")
}

/**
 * Prunes lines from the bottom of a string until it fits within maxTokens.
 * @param prompt The string to prune.
 * @param maxTokens The maximum number of tokens allowed.
 * @param modelName The model name for token counting.
 * @returns The pruned string.
 */
export function pruneLinesFromBottom(prompt: string, maxTokens: number, modelName: string): string {
	let totalTokens = countTokens(prompt, modelName)
	const lines = prompt.split("\n")
	while (totalTokens > maxTokens && lines.length > 0) {
		const lineToRemove = lines.pop()
		if (lineToRemove !== undefined) {
			totalTokens -= countTokens(lineToRemove, modelName)
			if (lines.length > 0) {
				// Also account for the newline character removed
				totalTokens -= countTokens("\n", modelName)
			}
		}
	}
	return lines.join("\n")
}
