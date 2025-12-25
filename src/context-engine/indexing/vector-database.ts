import type { CodeChunk, VectorSearchResult, SearchQuery, EmbeddingModel } from "../types"
import { EmbeddingService } from "../indexing/embedding-service"
import * as fs from "fs"
import * as path from "path"

/**
 * Vector database interface using LanceDB
 * Stores code embeddings for semantic search
 */
export class VectorDatabase {
	private dbPath: string
	private embeddingService: EmbeddingService
	private initialized: boolean
	private chunks: Map<string, CodeChunk>

	constructor(dbPath: string, embeddingModel: EmbeddingModel, openaiApiKey?: string, openaiBaseUrl?: string) {
		this.dbPath = dbPath
		this.embeddingService = new EmbeddingService(embeddingModel, openaiApiKey, openaiBaseUrl)
		this.initialized = false
		this.chunks = new Map()
	}

	/**
	 * Initialize the vector database
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return
		}

		// Ensure database directory exists
		const dbDir = path.dirname(this.dbPath)
		if (!fs.existsSync(dbDir)) {
			fs.mkdirSync(dbDir, { recursive: true })
		}

		// TODO: Initialize LanceDB connection
		// For now, use in-memory storage
		this.initialized = true
	}

	/**
	 * Add a single chunk to the vector database
	 */
	async addChunk(chunk: CodeChunk): Promise<void> {
		if (!this.initialized) {
			await this.initialize()
		}

		// Generate embedding if not present
		if (!chunk.embedding) {
			const text = this.prepareTextForEmbedding(chunk)
			chunk.embedding = await this.embeddingService.embed(text)
		}

		// Store chunk
		this.chunks.set(chunk.id, chunk)

		// TODO: Insert into LanceDB
	}

	/**
	 * Add multiple chunks in batch
	 */
	async addChunks(chunks: CodeChunk[]): Promise<void> {
		if (!this.initialized) {
			await this.initialize()
		}

		// Prepare texts for embedding
		const textsToEmbed: string[] = []
		const chunksNeedingEmbedding: CodeChunk[] = []

		for (const chunk of chunks) {
			if (!chunk.embedding) {
				textsToEmbed.push(this.prepareTextForEmbedding(chunk))
				chunksNeedingEmbedding.push(chunk)
			}
		}

		// Generate embeddings in batch
		if (textsToEmbed.length > 0) {
			const embeddings = await this.embeddingService.embedBatch(textsToEmbed)
			for (let i = 0; i < chunksNeedingEmbedding.length; i++) {
				chunksNeedingEmbedding[i].embedding = embeddings[i]
			}
		}

		// Store all chunks
		for (const chunk of chunks) {
			this.chunks.set(chunk.id, chunk)
		}

		// TODO: Batch insert into LanceDB
	}

	/**
	 * Search for similar code chunks
	 */
	async search(query: SearchQuery): Promise<VectorSearchResult[]> {
		if (!this.initialized) {
			await this.initialize()
		}

		// Generate query embedding
		const queryEmbedding = await this.embeddingService.embed(query.query)

		// Calculate similarity with all chunks
		const results: VectorSearchResult[] = []

		for (const chunk of this.chunks.values()) {
			if (!chunk.embedding) {
				continue
			}

			// Apply filters
			if (query.filters) {
				if (query.filters.languages && !query.filters.languages.includes(chunk.language)) {
					continue
				}
				if (query.filters.chunkTypes && !query.filters.chunkTypes.includes(chunk.type)) {
					continue
				}
				if (query.filters.filePattern && !chunk.filePath.match(query.filters.filePattern)) {
					continue
				}
			}

			const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding)

			results.push({
				chunk: query.includeEmbeddings ? chunk : { ...chunk, embedding: undefined },
				score: similarity,
				distance: 1 - similarity,
			})
		}

		// Sort by score descending
		results.sort((a, b) => b.score - a.score)

		// Limit results
		const limit = query.limit || 10
		return results.slice(0, limit)
	}

	/**
	 * Delete chunks by file path
	 */
	async deleteByFilePath(filePath: string): Promise<void> {
		const keysToDelete: string[] = []
		for (const [id, chunk] of this.chunks.entries()) {
			if (chunk.filePath === filePath) {
				keysToDelete.push(id)
			}
		}

		for (const key of keysToDelete) {
			this.chunks.delete(key)
		}

		// TODO: Delete from LanceDB
	}

	/**
	 * Get database statistics
	 */
	async getStats(): Promise<{ totalChunks: number; totalFiles: number; databaseSize: number }> {
		const uniqueFiles = new Set<string>()
		for (const chunk of this.chunks.values()) {
			uniqueFiles.add(chunk.filePath)
		}

		return {
			totalChunks: this.chunks.size,
			totalFiles: uniqueFiles.size,
			databaseSize: 0, // TODO: Calculate actual size
		}
	}

	/**
	 * Clear entire database
	 */
	async clear(): Promise<void> {
		this.chunks.clear()
		// TODO: Clear LanceDB
	}

	/**
	 * Prepare text for embedding (combine content + summary + metadata)
	 */
	private prepareTextForEmbedding(chunk: CodeChunk): string {
		let text = `File: ${chunk.filePath}\n`
		text += `Type: ${chunk.type}\n`
		text += `Summary: ${chunk.summary}\n`
		text += `\n${chunk.content}`

		return text
	}

	/**
	 * Close database connection
	 */
	async close(): Promise<void> {
		// TODO: Close LanceDB connection
		this.initialized = false
	}
}
