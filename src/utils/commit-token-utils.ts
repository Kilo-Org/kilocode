import { countTokens } from "./countTokens"
import { buildApiHandler } from "../api"
import { ContextProxy } from "../core/config/ContextProxy"

/**
 * Estimates token count for text content using the existing token counting infrastructure
 */
export async function estimateTokenCount(text: string): Promise<number> {
	if (!text || text.trim().length === 0) {
		return 0
	}

	const contentBlocks = [{ type: "text" as const, text }]
	return await countTokens(contentBlocks, { useWorker: false })
}

/**
 * Gets the current model's context window size
 */
export function getContextWindow(): number {
	try {
		const contextProxy = ContextProxy.instance
		const apiConfiguration = contextProxy.getProviderSettings()
		const apiHandler = buildApiHandler(apiConfiguration)
		return apiHandler.getModel().info.contextWindow || 200000
	} catch (error) {
		console.warn("Failed to get context window, using default:", error)
		return 200000
	}
}

/**
 * Checks if the given text would exceed the context window threshold
 */
export async function exceedsContextThreshold(text: string, threshold: number = 0.95): Promise<boolean> {
	const tokenCount = await estimateTokenCount(text)
	const contextWindow = getContextWindow()
	const maxTokensAllowed = Math.floor(contextWindow * threshold)

	return tokenCount > maxTokensAllowed
}

/**
 * Splits a git diff by files, respecting token limits
 */
export async function chunkDiffByFiles(
	diffText: string,
	targetChunkRatio: number = 0.4,
): Promise<{ chunks: string[]; wasChunked: boolean }> {
	const contextWindow = getContextWindow()
	const targetChunkSize = Math.floor(contextWindow * targetChunkRatio)

	// Check if the entire diff fits in one chunk
	const totalTokens = await estimateTokenCount(diffText)
	if (totalTokens <= targetChunkSize) {
		return { chunks: [diffText], wasChunked: false }
	}

	// Split by files using git diff format
	const fileChunks: string[] = []
	const fileDiffs = diffText.split(/^diff --git /m).filter((chunk) => chunk.trim())

	// If we only have one file, we can't chunk further
	if (fileDiffs.length <= 1) {
		return { chunks: [diffText], wasChunked: false }
	}

	let currentChunk = ""
	let currentChunkTokens = 0

	for (const fileDiff of fileDiffs) {
		const fullFileDiff = fileDiff.startsWith("a/") ? `diff --git ${fileDiff}` : fileDiff
		const fileTokens = await estimateTokenCount(fullFileDiff)

		// If adding this file would exceed the target, start a new chunk
		if (currentChunkTokens + fileTokens > targetChunkSize && currentChunk) {
			fileChunks.push(currentChunk.trim())
			currentChunk = fullFileDiff
			currentChunkTokens = fileTokens
		} else {
			currentChunk += (currentChunk ? "\n" : "") + fullFileDiff
			currentChunkTokens += fileTokens
		}
	}

	// Add the last chunk if it has content
	if (currentChunk.trim()) {
		fileChunks.push(currentChunk.trim())
	}

	return {
		chunks: fileChunks.length > 1 ? fileChunks : [diffText],
		wasChunked: fileChunks.length > 1,
	}
}
