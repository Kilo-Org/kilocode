// kilocode_change - new file

import { DatabaseManager } from "../storage"
import {
	DocumentationSource,
	DocumentationChunk,
	DocumentationIndex,
	SearchQuery,
	SearchResult,
	KnowledgeRetrievalResult,
	ScrapingConfig,
} from "./types"
import { DocumentationCrawler, CrawlerOptions } from "./documentation-crawler"
import { EventEmitter } from "events"

export interface KnowledgeServiceConfig {
	workspaceRoot: string
	databaseManager: DatabaseManager
	defaultScrapingConfig: ScrapingConfig
}

export class KnowledgeService extends EventEmitter {
	private databaseManager: DatabaseManager
	private config: KnowledgeServiceConfig
	private crawler: DocumentationCrawler
	private isInitialized = false

	constructor(config: KnowledgeServiceConfig) {
		super()
		this.config = config
		this.databaseManager = config.databaseManager

		this.crawler = new DocumentationCrawler({
			config: config.defaultScrapingConfig,
			onProgress: (progress) => this.emit("crawlingProgress", progress),
			onChunkProcessed: (chunk) => this.emit("chunkProcessed", chunk),
		})
	}

	/**
	 * Initialize the knowledge service
	 */
	async initialize(): Promise<void> {
		console.log("[KnowledgeService] Initializing knowledge service...")

		// Create documentation tables if they don't exist
		await this.createDocumentationTables()

		this.isInitialized = true
		console.log("[KnowledgeService] Knowledge service initialized")
	}

	/**
	 * Add a new documentation source
	 */
	async addDocumentationSource(source: Omit<DocumentationSource, "id">): Promise<string> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const id = this.generateId()
		const fullSource: DocumentationSource = { ...source, id }

		// Store source in database
		const db = this.databaseManager.getDatabase()
		await db?.run(
			`
			INSERT INTO documentation_sources (
				id, name, type, source, metadata, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`,
			id,
			fullSource.name,
			fullSource.type,
			fullSource.source,
			JSON.stringify(fullSource.metadata),
		)

		console.log(`[KnowledgeService] Added documentation source: ${fullSource.name}`)
		this.emit("sourceAdded", fullSource)

		return id
	}

	/**
	 * Remove a documentation source
	 */
	async removeDocumentationSource(sourceId: string): Promise<void> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		// Delete chunks and index entries first
		const db = this.databaseManager.getDatabase()
		await db?.run(
			`
			DELETE FROM documentation_chunks WHERE source_id = ?
		`,
			sourceId,
		)

		await db?.run(
			`
			DELETE FROM documentation_index WHERE source_id = ?
		`,
			sourceId,
		)

		// Delete the source
		await db?.run(
			`
			DELETE FROM documentation_sources WHERE id = ?
		`,
			sourceId,
		)

		console.log(`[KnowledgeService] Removed documentation source: ${sourceId}`)
		this.emit("sourceRemoved", sourceId)
	}

	/**
	 * Get all documentation sources
	 */
	async getDocumentationSources(): Promise<DocumentationSource[]> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const db = this.databaseManager.getDatabase()
		const rows =
			(await db?.all(`
			SELECT * FROM documentation_sources ORDER BY name
		`)) || []

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			type: row.type,
			source: row.source,
			metadata: JSON.parse(row.metadata),
		}))
	}

	/**
	 * Index a documentation source (crawl and process)
	 */
	async indexSource(sourceId: string): Promise<DocumentationChunk[]> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const sources = await this.getDocumentationSources()
		const source = sources.find((s) => s.id === sourceId)

		if (!source) {
			throw new Error(`Documentation source not found: ${sourceId}`)
		}

		console.log(`[KnowledgeService] Starting indexing for source: ${source.name}`)

		try {
			// Crawl the source
			const chunks = await this.crawler.crawlSource(source)

			// Store chunks in database
			await this.storeChunks(sourceId, chunks)

			// Update source metadata
			await this.updateSourceMetadata(sourceId, {
				...source.metadata,
				lastUpdated: new Date(),
			})

			console.log(`[KnowledgeService] Indexed ${chunks.length} chunks for source: ${source.name}`)
			this.emit("sourceIndexed", { sourceId, chunks })

			return chunks
		} catch (error) {
			console.error(`[KnowledgeService] Failed to index source ${sourceId}:`, error)
			throw error
		}
	}

	/**
	 * Search documentation using semantic search
	 */
	async search(query: SearchQuery): Promise<KnowledgeRetrievalResult> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const startTime = Date.now()

		try {
			// Build SQL query with filters
			const db = this.databaseManager.getDatabase()
			let sql = `
				SELECT DISTINCT 
					dc.id,
					dc.source_id,
					dc.content,
					dc.metadata,
					dc.created_at,
					di.vector_embedding,
					ds.name as source_name,
					ds.type as source_type
				FROM documentation_chunks dc
				LEFT JOIN documentation_index di ON dc.id = di.chunk_id
				LEFT JOIN documentation_sources ds ON dc.source_id = ds.id
				WHERE 1=1
			`

			const params: any[] = []

			// Add source filters
			if (query.sourceIds && query.sourceIds.length > 0) {
				sql += ` AND dc.source_id IN (${query.sourceIds.map(() => "?").join(",")})`
				params.push(...query.sourceIds)
			}

			// Add tag filters
			if (query.tags && query.tags.length > 0) {
				sql += ` AND (
					SELECT COUNT(*) FROM json_each(dc.metadata) 
					WHERE json_extract(json_each.value, '$.tags') LIKE ?
				) > 0`

				for (const tag of query.tags) {
					params.push(`%${tag}%`)
				}
			}

			// Add text search (basic implementation)
			if (query.query) {
				sql += ` AND (dc.content LIKE ? OR json_extract(dc.metadata, '$.title') LIKE ?)`
				params.push(`%${query.query}%`, `%${query.query}%`)
			}

			sql += ` ORDER BY dc.created_at DESC LIMIT ?`
			params.push(query.limit || 10)

			const rows = (await db?.all(sql, ...params)) || []

			// Convert to SearchResult format
			const results: SearchResult[] = rows.map((row, index) => ({
				chunk: {
					id: row.id,
					sourceId: row.source_id,
					content: row.content,
					metadata: JSON.parse(row.metadata),
					createdAt: new Date(row.created_at),
				},
				score: 1.0 - index * 0.1, // Simple scoring based on position
				relevance: this.calculateRelevance(query.query, row.content, JSON.parse(row.metadata)),
			}))

			// Filter by threshold
			const filteredResults = results.filter((result) => result.score >= (query.threshold || 0.5))

			// Get unique sources
			const sourceIds = [...new Set(filteredResults.map((r) => r.chunk.sourceId))]
			const sources = await this.getDocumentationSources()
			const relevantSources = sources.filter((s) => sourceIds.includes(s.id))

			const executionTime = Date.now() - startTime

			return {
				query: query.query,
				results: filteredResults,
				totalResults: filteredResults.length,
				sources: relevantSources,
				executionTime,
			}
		} catch (error) {
			console.error("[KnowledgeService] Search failed:", error)
			throw error
		}
	}

	/**
	 * Get documentation chunks by source ID
	 */
	async getChunksBySource(sourceId: string): Promise<DocumentationChunk[]> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const db = this.databaseManager.getDatabase()
		const rows =
			(await db?.all(
				`
			SELECT * FROM documentation_chunks 
			WHERE source_id = ? 
			ORDER BY created_at
		`,
				sourceId,
			)) || []

		return rows.map((row) => ({
			id: row.id,
			sourceId: row.source_id,
			content: row.content,
			metadata: JSON.parse(row.metadata),
			createdAt: new Date(row.created_at),
		}))
	}

	/**
	 * Get statistics about the knowledge base
	 */
	async getStatistics(): Promise<{
		totalSources: number
		totalChunks: number
		totalSize: number
		sourcesByType: Record<string, number>
		lastUpdated: Date | null
	}> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		// Get total sources
		const db = this.databaseManager.getDatabase()
		const sourceCount = (await db?.get(`
			SELECT COUNT(*) as count FROM documentation_sources
		`)) || { count: 0 }

		// Get total chunks
		const chunkCount = (await db?.get(`
			SELECT COUNT(*) as count FROM documentation_chunks
		`)) || { count: 0 }

		// Get total size (approximate)
		const sizeResult = (await db?.get(`
			SELECT SUM(LENGTH(content)) as total_size FROM documentation_chunks
		`)) || { total_size: 0 }

		// Get sources by type
		const typeResults =
			(await db?.all(`
			SELECT type, COUNT(*) as count FROM documentation_sources GROUP BY type
		`)) || []

		const sourcesByType = typeResults.reduce(
			(acc, row) => {
				acc[row.type] = row.count
				return acc
			},
			{} as Record<string, number>,
		)

		// Get last updated
		const lastUpdatedResult = (await db?.get(`
			SELECT MAX(updated_at) as last_updated FROM documentation_sources
		`)) || { last_updated: null }

		return {
			totalSources: sourceCount.count,
			totalChunks: chunkCount.count,
			totalSize: sizeResult.total_size,
			sourcesByType,
			lastUpdated: lastUpdatedResult.last_updated ? new Date(lastUpdatedResult.last_updated) : null,
		}
	}

	/**
	 * Create documentation tables in the database
	 */
	private async createDocumentationTables(): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) {
			throw new Error("Database not initialized")
		}

		// Documentation sources table
		await db.exec(`
			CREATE TABLE IF NOT EXISTS documentation_sources (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('url', 'local_file', 'pdf')),
				source TEXT NOT NULL,
				metadata TEXT, -- JSON metadata
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`)

		// Documentation chunks table
		await db.exec(`
			CREATE TABLE IF NOT EXISTS documentation_chunks (
				id TEXT PRIMARY KEY,
				source_id TEXT NOT NULL,
				content TEXT NOT NULL,
				metadata TEXT, -- JSON metadata including tags, title, section, etc.
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (source_id) REFERENCES documentation_sources(id) ON DELETE CASCADE
			)
		`)

		// Documentation index table for vector search
		await db.exec(`
			CREATE TABLE IF NOT EXISTS documentation_index (
				id TEXT PRIMARY KEY,
				source_id TEXT NOT NULL,
				chunk_id TEXT NOT NULL,
				content TEXT NOT NULL,
				vector_embedding BLOB, -- Vector embedding for semantic search
				metadata TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (source_id) REFERENCES documentation_sources(id) ON DELETE CASCADE,
				FOREIGN KEY (chunk_id) REFERENCES documentation_chunks(id) ON DELETE CASCADE
			)
		`)

		// Create indexes
		await db.exec(`
			CREATE INDEX IF NOT EXISTS idx_doc_sources_name ON documentation_sources(name);
			CREATE INDEX IF NOT EXISTS idx_doc_sources_type ON documentation_sources(type);
			CREATE INDEX IF NOT EXISTS idx_doc_chunks_source_id ON documentation_chunks(source_id);
			CREATE INDEX IF NOT EXISTS idx_doc_chunks_created_at ON documentation_chunks(created_at);
			CREATE INDEX IF NOT EXISTS idx_doc_index_source_id ON documentation_index(source_id);
			CREATE INDEX IF NOT EXISTS idx_doc_index_chunk_id ON documentation_index(chunk_id);
		`)

		console.log("[KnowledgeService] Documentation tables created")
	}

	/**
	 * Store chunks in the database
	 */
	private async storeChunks(sourceId: string, chunks: DocumentationChunk[]): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) {
			throw new Error("Database not initialized")
		}

		// Start transaction
		await db.exec("BEGIN TRANSACTION")

		try {
			for (const chunk of chunks) {
				// Store chunk
				await db.run(
					`
					INSERT OR REPLACE INTO documentation_chunks (
						id, source_id, content, metadata, created_at
					) VALUES (?, ?, ?, ?, ?)
				`,
					chunk.id,
					chunk.sourceId,
					chunk.content,
					JSON.stringify(chunk.metadata),
					chunk.createdAt.toISOString(),
				)

				// Store index entry (vector embedding would be added here)
				await db.run(
					`
					INSERT OR REPLACE INTO documentation_index (
						id, source_id, chunk_id, content, metadata, created_at
					) VALUES (?, ?, ?, ?, ?, ?)
				`,
					`${chunk.id}-index`,
					chunk.sourceId,
					chunk.id,
					chunk.content,
					JSON.stringify(chunk.metadata),
					chunk.createdAt.toISOString(),
				)
			}

			// Commit transaction
			await db.exec("COMMIT")
		} catch (error) {
			// Rollback on error
			await db.exec("ROLLBACK")
			throw error
		}
	}

	/**
	 * Update source metadata
	 */
	private async updateSourceMetadata(sourceId: string, metadata: any): Promise<void> {
		const db = this.databaseManager.getDatabase()
		await db?.run(
			`
			UPDATE documentation_sources 
			SET metadata = ?, updated_at = CURRENT_TIMESTAMP 
			WHERE id = ?
		`,
			JSON.stringify(metadata),
			sourceId,
		)
	}

	/**
	 * Calculate relevance score for search results
	 */
	private calculateRelevance(query: string, content: string, metadata: any): string {
		if (!query) return "content_match"

		const queryLower = query.toLowerCase()
		const contentLower = content.toLowerCase()
		const title = metadata.title || ""

		// Check for exact matches
		if (contentLower.includes(queryLower) || title.toLowerCase().includes(queryLower)) {
			return "exact_match"
		}

		// Check for partial matches
		const queryWords = queryLower.split(/\s+/)
		const contentWords = contentLower.split(/\s+/)
		const matches = queryWords.filter((word) => contentWords.includes(word))

		if (matches.length > queryWords.length * 0.7) {
			return "high_match"
		} else if (matches.length > queryWords.length * 0.3) {
			return "partial_match"
		}

		return "content_match"
	}

	/**
	 * Generate a unique ID
	 */
	private generateId(): string {
		return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Clean up old data
	 */
	async cleanup(olderThanDays: number = 30): Promise<void> {
		if (!this.isInitialized) {
			throw new Error("Knowledge service not initialized")
		}

		const cutoffDate = new Date()
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

		// Delete old chunks and index entries
		const db = this.databaseManager.getDatabase()
		await db?.run(
			`
			DELETE FROM documentation_index 
			WHERE created_at < ?
		`,
			cutoffDate.toISOString(),
		)

		await db?.run(
			`
			DELETE FROM documentation_chunks 
			WHERE created_at < ?
		`,
			cutoffDate.toISOString(),
		)

		console.log(`[KnowledgeService] Cleaned up data older than ${olderThanDays} days`)
		this.emit("cleanup", { olderThanDays, cutoffDate })
	}
}
