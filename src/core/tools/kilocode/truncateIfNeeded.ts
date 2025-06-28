const SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION = 0.2
const TOKENS_PER_CHARACTER = 3

function tokenEstimate(text: string) {
	// Very crude metric, but it is fast to compute and scales linearly.
	return text.length / TOKENS_PER_CHARACTER
}
function computeLinesToKeep(lines: string[], maxTokens: number) {
	let currentEstimate = 0
	let linesToKeep = 0
	while (linesToKeep < lines.length) {
		const lineEstimate = tokenEstimate(lines[linesToKeep])
		if (currentEstimate + lineEstimate > maxTokens) {
			break
		}

		currentEstimate += lineEstimate
		linesToKeep++
	}
	return linesToKeep
}

export function truncateIfNeeded(text: string, contextWindow: number) {
	const maxTokens = SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION * contextWindow
	if (tokenEstimate(text) <= maxTokens) {
		return text
	}

	const lines = text.split("\n")
	let linesToKeep = computeLinesToKeep(lines, maxTokens)
	const truncatedText = lines.slice(0, linesToKeep).join("\n")

	return `**Important:** The output below was truncated from ${lines.length} lines to ${linesToKeep} lines due to size limits and is therefore *incomplete*! You *must* notify the user of this!

${truncatedText}`
}
