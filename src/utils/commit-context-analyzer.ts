import { countTokens } from "./countTokens"
import { buildApiHandler } from "../api"
import { ContextProxy } from "../core/config/ContextProxy"

/**
 * Configuration for context analysis
 */
export interface ContextAnalysisOptions {
	contextWindowThreshold?: number
	targetChunkRatio?: number
	maxChunks?: number
}

/**
 * Result of context analysis
 */
export interface ContextAnalysisResult {
	tokenCount: number
	contextWindow: number
	requiresChunking: boolean
	maxTokensAllowed: number
}

/**
 * Information about a diff chunk for processing
 */
export interface DiffChunk {
	diff: string
	files: string[]
	summary?: string
}

/**
 * Result of chunking operation
 */
export interface ChunkingResult {
	chunks: DiffChunk[]
	wasChunked: boolean
	totalOriginalTokens: number
}

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
 * Analyzes git context to determine if chunking is needed
 */
export async function analyzeGitContext(
	gitContext: string,
	options: ContextAnalysisOptions = {},
): Promise<ContextAnalysisResult> {
	const { contextWindowThreshold = 0.95 } = options

	// Get context window from current model configuration
	const contextProxy = ContextProxy.instance
	const apiConfiguration = contextProxy.getProviderSettings()
	const apiHandler = buildApiHandler(apiConfiguration)
	const contextWindow = apiHandler.getModel().info.contextWindow || 200000

	// Estimate token count for the git context
	const tokenCount = await estimateTokenCount(gitContext)
	const maxTokensAllowed = Math.floor(contextWindow * contextWindowThreshold)
	const requiresChunking = tokenCount > maxTokensAllowed

	return {
		tokenCount,
		contextWindow,
		requiresChunking,
		maxTokensAllowed,
	}
}

/**
 * Chunks a git diff by files to fit within context windows
 */
export async function chunkGitDiffByFiles(
	diffText: string,
	options: ContextAnalysisOptions = {},
): Promise<ChunkingResult> {
	const { targetChunkRatio = 0.2, maxChunks = 10 } = options
	const totalOriginalTokens = await estimateTokenCount(diffText)

	// Get context window for chunk sizing
	const contextProxy = ContextProxy.instance
	const apiConfiguration = contextProxy.getProviderSettings()
	const apiHandler = buildApiHandler(apiConfiguration)
	const contextWindow = apiHandler.getModel().info.contextWindow || 200000
	const targetChunkSize = Math.floor(contextWindow * targetChunkRatio)

	// Extract individual file diffs
	const fileDiffs = extractFileDiffsFromText(diffText)

	if (fileDiffs.length === 0) {
		return {
			chunks: [],
			wasChunked: false,
			totalOriginalTokens,
		}
	}

	// If only one file, don't chunk (even if large)
	// If multiple files but total content is small enough, don't chunk
	if (fileDiffs.length === 1) {
		const chunk: DiffChunk = {
			diff: diffText,
			files: fileDiffs.map((fd) => fd.filePath),
		}

		return {
			chunks: [chunk],
			wasChunked: false,
			totalOriginalTokens,
		}
	}

	// For multiple files, check if total size is small enough to fit in one chunk
	if (process.env.NODE_ENV === "test") {
		console.log("Pre-chunking check:", {
			totalOriginalTokens,
			targetChunkSize,
			condition: totalOriginalTokens <= targetChunkSize,
		})
	}

	if (totalOriginalTokens <= targetChunkSize) {
		const chunk: DiffChunk = {
			diff: diffText,
			files: fileDiffs.map((fd) => fd.filePath),
		}

		return {
			chunks: [chunk],
			wasChunked: false,
			totalOriginalTokens,
		}
	}

	// Debug logging for tests
	if (process.env.NODE_ENV === "test") {
		console.log("Chunking debug:", {
			totalOriginalTokens,
			targetChunkSize,
			contextWindow,
			targetChunkRatio: options.targetChunkRatio,
			shouldChunk: totalOriginalTokens > targetChunkSize,
		})
	}

	// Group files into chunks based on token size
	const chunks: DiffChunk[] = []
	let currentChunkFiles: FileDiff[] = []
	let currentChunkTokens = 0
	let chunkIndex = 1

	for (const fileDiff of fileDiffs) {
		const fileTokens = await estimateTokenCount(fileDiff.diff)

		// If adding this file would exceed target size, finalize current chunk
		if (currentChunkFiles.length > 0 && currentChunkTokens + fileTokens > targetChunkSize) {
			const chunk = createChunkFromFiles(currentChunkFiles)
			chunks.push(chunk)
			currentChunkFiles = []
			currentChunkTokens = 0
			chunkIndex++
		}

		currentChunkFiles.push(fileDiff)
		currentChunkTokens += fileTokens

		// Prevent too many chunks
		if (chunks.length >= maxChunks - 1) {
			break
		}
	}

	// Add remaining files to final chunk
	if (currentChunkFiles.length > 0) {
		const chunk = createChunkFromFiles(currentChunkFiles)
		chunks.push(chunk)
	}

	return {
		chunks,
		wasChunked: chunks.length > 1,
		totalOriginalTokens,
	}
}

// Helper interfaces and functions

interface FileDiff {
	filePath: string
	diff: string
	header: string
}

/**
 * Extracts individual file diffs from a combined diff text
 */
function extractFileDiffsFromText(diffText: string): FileDiff[] {
	const fileDiffs: FileDiff[] = []
	const lines = diffText.split("\n")
	let currentFile: FileDiff | null = null
	let currentDiffLines: string[] = []

	for (const line of lines) {
		if (line.startsWith("diff --git")) {
			// Save previous file if exists
			if (currentFile && currentDiffLines.length > 0) {
				currentFile.diff = currentDiffLines.join("\n")
				fileDiffs.push(currentFile)
			}

			// Start new file
			const match = line.match(/diff --git a\/(.+) b\/(.+)/)
			const filePath = match ? match[1] : "unknown"

			currentFile = {
				filePath,
				diff: "",
				header: line,
			}
			currentDiffLines = [line]
		} else if (currentFile) {
			currentDiffLines.push(line)
		}
	}

	// Add final file
	if (currentFile && currentDiffLines.length > 0) {
		currentFile.diff = currentDiffLines.join("\n")
		fileDiffs.push(currentFile)
	}

	return fileDiffs
}

/**
 * Creates a DiffChunk from a collection of FileDiff objects
 */
function createChunkFromFiles(files: FileDiff[]): DiffChunk {
	const combinedDiff = files.map((f) => f.diff).join("\n\n")
	const filePaths = files.map((f) => f.filePath)

	return {
		diff: combinedDiff,
		files: filePaths,
	}
}
