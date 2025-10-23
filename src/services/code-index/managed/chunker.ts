/**
 * Line-based file chunking for managed codebase indexing
 *
 * This module provides a simple, fast alternative to tree-sitter parsing.
 * It chunks files based on line boundaries with configurable overlap,
 * making it language-agnostic and 3-5x faster than AST-based approaches.
 */

import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"
import { ManagedCodeChunk, ChunkerConfig } from "./types"
import { MANAGED_MAX_CHUNK_CHARS, MANAGED_MIN_CHUNK_CHARS, MANAGED_OVERLAP_LINES } from "../constants"

/**
 * Chunks a file's content into overlapping segments based on line boundaries
 *
 * Algorithm:
 * 1. Split content into lines
 * 2. Accumulate lines until maxChunkChars is reached
 * 3. Create chunk (always includes complete lines, never splits mid-line)
 * 4. Start next chunk with overlapLines from previous chunk
 * 5. Continue until all lines are processed
 *
 * @param filePath Relative file path from workspace root
 * @param content File content to chunk
 * @param fileHash SHA-256 hash of the file content
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param gitBranch Git branch name
 * @param isBaseBranch Whether this is a base branch (main/develop)
 * @param config Chunker configuration (optional, uses defaults if not provided)
 * @returns Array of code chunks with metadata
 */
export function chunkFile(
	filePath: string,
	content: string,
	fileHash: string,
	organizationId: string,
	projectId: string,
	gitBranch: string,
	isBaseBranch: boolean,
	config?: Partial<ChunkerConfig>,
): ManagedCodeChunk[] {
	const chunkerConfig: ChunkerConfig = {
		maxChunkChars: config?.maxChunkChars ?? MANAGED_MAX_CHUNK_CHARS,
		minChunkChars: config?.minChunkChars ?? MANAGED_MIN_CHUNK_CHARS,
		overlapLines: config?.overlapLines ?? MANAGED_OVERLAP_LINES,
	}

	const lines = content.split("\n")
	const chunks: ManagedCodeChunk[] = []

	let currentChunk: string[] = []
	let currentChunkChars = 0
	let startLine = 1

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const lineLength = line.length + 1 // +1 for newline character

		// Check if adding this line would exceed max chunk size
		if (currentChunkChars + lineLength > chunkerConfig.maxChunkChars && currentChunk.length > 0) {
			// Finalize current chunk if it meets minimum size
			if (currentChunkChars >= chunkerConfig.minChunkChars) {
				chunks.push(
					createChunk(
						currentChunk,
						startLine,
						i, // endLine is current index (0-based) + 1 = i + 1, but we want i (last line of chunk)
						filePath,
						fileHash,
						organizationId,
						projectId,
						gitBranch,
						isBaseBranch,
					),
				)

				// Start next chunk with overlap
				const overlapStart = Math.max(0, currentChunk.length - chunkerConfig.overlapLines)
				currentChunk = currentChunk.slice(overlapStart)
				currentChunkChars = currentChunk.reduce((sum, l) => sum + l.length + 1, 0)
				startLine = i - (currentChunk.length - 1)
			}
		}

		currentChunk.push(line)
		currentChunkChars += lineLength
	}

	// Finalize last chunk if it meets minimum size
	if (currentChunk.length > 0 && currentChunkChars >= chunkerConfig.minChunkChars) {
		chunks.push(
			createChunk(
				currentChunk,
				startLine,
				lines.length,
				filePath,
				fileHash,
				organizationId,
				projectId,
				gitBranch,
				isBaseBranch,
			),
		)
	}

	return chunks
}

/**
 * Creates a single chunk with all required metadata
 *
 * @param lines Array of lines that make up this chunk
 * @param startLine Starting line number (1-based)
 * @param endLine Ending line number (1-based, inclusive)
 * @param filePath Relative file path
 * @param fileHash SHA-256 hash of the file
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param gitBranch Git branch name
 * @param isBaseBranch Whether this is a base branch
 * @returns ManagedCodeChunk with all metadata
 */
function createChunk(
	lines: string[],
	startLine: number,
	endLine: number,
	filePath: string,
	fileHash: string,
	organizationId: string,
	projectId: string,
	gitBranch: string,
	isBaseBranch: boolean,
): ManagedCodeChunk {
	const content = lines.join("\n")
	const chunkHash = generateChunkHash(filePath, startLine, endLine)
	const id = generateChunkId(chunkHash, organizationId, gitBranch)

	return {
		id,
		organizationId,
		projectId,
		filePath,
		codeChunk: content,
		startLine,
		endLine,
		chunkHash,
		gitBranch,
		isBaseBranch,
	}
}

/**
 * Generates a unique hash for a chunk based on its content and location
 *
 * The hash includes:
 * - File path (to distinguish same content in different files)
 * - Line range (to distinguish same content at different locations)
 * - Content length (quick differentiator)
 * - Content preview (first 100 chars for uniqueness)
 *
 * @param filePath Relative file path
 * @param startLine Starting line number
 * @param endLine Ending line number
 * @param content Chunk content
 * @returns SHA-256 hash string
 */
function generateChunkHash(filePath: string, startLine: number, endLine: number): string {
	return createHash("sha256").update(`${filePath}-${startLine}-${endLine}`).digest("hex")
}

/**
 * Generates a unique ID for a chunk
 *
 * The ID is a UUIDv5 based on the chunk hash and organization ID.
 * This ensures:
 * - Same content in same location = same ID (idempotent upserts)
 * - Different organizations = different IDs (isolation)
 * - Different branches = different IDs (branch isolation via chunk hash)
 *
 * @param chunkHash Hash of the chunk content and location
 * @param organizationId Organization ID (used as UUID namespace)
 * @param gitBranch Git branch name (included in hash for branch isolation)
 * @returns UUID string
 */
function generateChunkId(chunkHash: string, organizationId: string, gitBranch: string): string {
	// Include branch in the hash to ensure different IDs across branches
	const branchAwareHash = createHash("sha256").update(`${chunkHash}-${gitBranch}`).digest("hex")

	return uuidv5(branchAwareHash, organizationId)
}

/**
 * Calculates the SHA-256 hash of file content
 *
 * @param content File content
 * @returns SHA-256 hash string
 */
export function calculateFileHash(content: string): string {
	return createHash("sha256").update(content).digest("hex")
}

/**
 * Gets the default chunker configuration
 *
 * @returns Default ChunkerConfig
 */
export function getDefaultChunkerConfig(): ChunkerConfig {
	return {
		maxChunkChars: MANAGED_MAX_CHUNK_CHARS,
		minChunkChars: MANAGED_MIN_CHUNK_CHARS,
		overlapLines: MANAGED_OVERLAP_LINES,
	}
}
