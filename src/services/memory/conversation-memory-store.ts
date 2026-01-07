// kilocode_change - new file
// Task 2.1.1: Conversation Memory Store

import { DatabaseManager } from "../storage/database-manager"
import crypto from "crypto"

/**
 * Memory types for classification
 */
export type MemoryType = "semantic" | "episodic" | "procedural"

/**
 * Memory priority levels
 */
export type MemoryPriority = "critical" | "high" | "medium" | "low"

/**
 * A stored conversation memory
 */
export interface ConversationMemory {
	id: string
	taskId: string
	workspaceRoot: string
	type: MemoryType
	priority: MemoryPriority
	title: string
	summary: string
	content: string
	embedding?: number[]
	tags: string[]
	relatedFiles: string[]
	createdAt: number
	lastAccessedAt: number
	accessCount: number
	metadata: Record<string, any>
}

/**
 * Memory search query
 */
export interface MemorySearchQuery {
	query?: string
	type?: MemoryType
	priority?: MemoryPriority
	tags?: string[]
	workspaceRoot?: string
	limit?: number
	minRelevance?: number
}

/**
 * Memory search result
 */
export interface MemorySearchResult {
	memory: ConversationMemory
	relevanceScore: number
}

/**
 * Memory store configuration
 */
export interface MemoryStoreConfig {
	/** Maximum memories to keep per workspace */
	maxMemoriesPerWorkspace: number
	/** Enable automatic memory pruning */
	autoPrune: boolean
	/** Days after which unused memories are pruned */
	pruneDays: number
}

const DEFAULT_CONFIG: MemoryStoreConfig = {
	maxMemoriesPerWorkspace: 1000,
	autoPrune: true,
	pruneDays: 90,
}

/**
 * Long-term conversation memory store with semantic search capabilities.
 * Stores important conversation patterns, decisions, and knowledge.
 */
export class ConversationMemoryStore {
	private databaseManager: DatabaseManager | null = null
	private config: MemoryStoreConfig
	private isInitialized = false

	// In-memory cache for recent memories
	private recentMemories: Map<string, ConversationMemory> = new Map()
	private maxRecentMemories = 100

	constructor(config: Partial<MemoryStoreConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Initialize the memory store
	 */
	async initialize(databaseManager: DatabaseManager): Promise<void> {
		if (this.isInitialized) return

		this.databaseManager = databaseManager
		await this.createMemoryTables()
		await this.loadRecentMemories()

		if (this.config.autoPrune) {
			await this.pruneOldMemories()
		}

		this.isInitialized = true
	}

	/**
	 * Store a new memory
	 */
	async store(
		memory: Omit<ConversationMemory, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
	): Promise<string> {
		const id = crypto.randomUUID()
		const now = Date.now()

		const fullMemory: ConversationMemory = {
			...memory,
			id,
			createdAt: now,
			lastAccessedAt: now,
			accessCount: 0,
		}

		// Add to recent cache
		this.addToRecentCache(fullMemory)

		// Persist to database
		if (this.databaseManager) {
			await this.saveToDatabase(fullMemory)
		}

		return id
	}

	/**
	 * Retrieve a memory by ID
	 */
	async get(id: string): Promise<ConversationMemory | null> {
		// Check recent cache first
		const cached = this.recentMemories.get(id)
		if (cached) {
			cached.lastAccessedAt = Date.now()
			cached.accessCount++
			return cached
		}

		// Load from database
		if (this.databaseManager) {
			const memory = await this.loadFromDatabase(id)
			if (memory) {
				this.addToRecentCache(memory)
				await this.updateAccessStats(id)
				return memory
			}
		}

		return null
	}

	/**
	 * Search memories using semantic similarity or filters
	 */
	async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
		const results: MemorySearchResult[] = []
		const limit = query.limit || 10

		if (!this.databaseManager) {
			// Search in-memory only
			return this.searchInMemory(query)
		}

		const db = (this.databaseManager as any).db
		if (!db) return results

		let sql = `SELECT * FROM conversation_memories WHERE 1=1`
		const params: any[] = []

		if (query.workspaceRoot) {
			sql += ` AND workspace_root = ?`
			params.push(query.workspaceRoot)
		}

		if (query.type) {
			sql += ` AND type = ?`
			params.push(query.type)
		}

		if (query.priority) {
			sql += ` AND priority = ?`
			params.push(query.priority)
		}

		if (query.tags && query.tags.length > 0) {
			// Search for any matching tag
			const tagConditions = query.tags.map(() => `tags LIKE ?`).join(" OR ")
			sql += ` AND (${tagConditions})`
			params.push(...query.tags.map((tag) => `%${tag}%`))
		}

		sql += ` ORDER BY access_count DESC, last_accessed_at DESC LIMIT ?`
		params.push(limit * 2) // Get more to filter by relevance

		const rows = await db.all(sql, params)

		for (const row of rows) {
			const memory = this.rowToMemory(row)
			let relevanceScore = 0.5 // Base score

			// Calculate relevance based on query match
			if (query.query) {
				relevanceScore = this.calculateRelevance(memory, query.query)
				if (query.minRelevance && relevanceScore < query.minRelevance) {
					continue
				}
			}

			// Boost by recency
			const daysSinceAccess = (Date.now() - memory.lastAccessedAt) / (24 * 60 * 60 * 1000)
			relevanceScore *= Math.max(0.5, 1 - daysSinceAccess / 30)

			// Boost by access count
			relevanceScore *= Math.min(2, 1 + memory.accessCount / 10)

			results.push({ memory, relevanceScore })
		}

		// Sort by relevance and limit
		results.sort((a, b) => b.relevanceScore - a.relevanceScore)
		return results.slice(0, limit)
	}

	/**
	 * Get memories related to specific files
	 */
	async getByFiles(filePaths: string[], limit = 10): Promise<ConversationMemory[]> {
		if (!this.databaseManager) return []

		const db = (this.databaseManager as any).db
		if (!db) return []

		const placeholders = filePaths.map(() => `related_files LIKE ?`).join(" OR ")
		const params = filePaths.map((f) => `%${f}%`)

		const rows = await db.all(
			`SELECT * FROM conversation_memories 
			WHERE ${placeholders}
			ORDER BY access_count DESC, last_accessed_at DESC
			LIMIT ?`,
			[...params, limit],
		)

		return rows.map((row: any) => this.rowToMemory(row))
	}

	/**
	 * Update an existing memory
	 */
	async update(id: string, updates: Partial<Omit<ConversationMemory, "id" | "createdAt">>): Promise<void> {
		// Update in cache
		const cached = this.recentMemories.get(id)
		if (cached) {
			Object.assign(cached, updates, { lastAccessedAt: Date.now() })
		}

		// Update in database
		if (this.databaseManager) {
			const db = (this.databaseManager as any).db
			if (!db) return

			const fields: string[] = []
			const values: any[] = []

			if (updates.summary !== undefined) {
				fields.push("summary = ?")
				values.push(updates.summary)
			}
			if (updates.content !== undefined) {
				fields.push("content = ?")
				values.push(updates.content)
			}
			if (updates.tags !== undefined) {
				fields.push("tags = ?")
				values.push(JSON.stringify(updates.tags))
			}
			if (updates.priority !== undefined) {
				fields.push("priority = ?")
				values.push(updates.priority)
			}
			if (updates.metadata !== undefined) {
				fields.push("metadata = ?")
				values.push(JSON.stringify(updates.metadata))
			}

			if (fields.length > 0) {
				fields.push("last_accessed_at = ?")
				values.push(Date.now())
				values.push(id)

				await db.run(`UPDATE conversation_memories SET ${fields.join(", ")} WHERE id = ?`, values)
			}
		}
	}

	/**
	 * Delete a memory
	 */
	async delete(id: string): Promise<void> {
		this.recentMemories.delete(id)

		if (this.databaseManager) {
			const db = (this.databaseManager as any).db
			if (db) {
				await db.run(`DELETE FROM conversation_memories WHERE id = ?`, [id])
			}
		}
	}

	/**
	 * Get memory statistics
	 */
	async getStats(): Promise<{
		totalMemories: number
		memoriesByType: Record<MemoryType, number>
		memoriesByPriority: Record<MemoryPriority, number>
		oldestMemory: Date | null
		newestMemory: Date | null
	}> {
		if (!this.databaseManager) {
			return {
				totalMemories: this.recentMemories.size,
				memoriesByType: { semantic: 0, episodic: 0, procedural: 0 },
				memoriesByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
				oldestMemory: null,
				newestMemory: null,
			}
		}

		const db = (this.databaseManager as any).db
		if (!db) {
			return {
				totalMemories: 0,
				memoriesByType: { semantic: 0, episodic: 0, procedural: 0 },
				memoriesByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
				oldestMemory: null,
				newestMemory: null,
			}
		}

		const total = await db.get(`SELECT COUNT(*) as count FROM conversation_memories`)
		const byType = await db.all(`SELECT type, COUNT(*) as count FROM conversation_memories GROUP BY type`)
		const byPriority = await db.all(
			`SELECT priority, COUNT(*) as count FROM conversation_memories GROUP BY priority`,
		)
		const dates = await db.get(
			`SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM conversation_memories`,
		)

		const typeMap: Record<MemoryType, number> = { semantic: 0, episodic: 0, procedural: 0 }
		const priorityMap: Record<MemoryPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 }

		for (const row of byType) {
			typeMap[row.type as MemoryType] = row.count
		}
		for (const row of byPriority) {
			priorityMap[row.priority as MemoryPriority] = row.count
		}

		return {
			totalMemories: total?.count || 0,
			memoriesByType: typeMap,
			memoriesByPriority: priorityMap,
			oldestMemory: dates?.oldest ? new Date(dates.oldest) : null,
			newestMemory: dates?.newest ? new Date(dates.newest) : null,
		}
	}

	// Private methods

	private async createMemoryTables(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.exec(`
			CREATE TABLE IF NOT EXISTS conversation_memories (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL,
				workspace_root TEXT NOT NULL,
				type TEXT NOT NULL,
				priority TEXT NOT NULL,
				title TEXT NOT NULL,
				summary TEXT NOT NULL,
				content TEXT NOT NULL,
				embedding BLOB,
				tags TEXT NOT NULL DEFAULT '[]',
				related_files TEXT NOT NULL DEFAULT '[]',
				created_at INTEGER NOT NULL,
				last_accessed_at INTEGER NOT NULL,
				access_count INTEGER DEFAULT 0,
				metadata TEXT NOT NULL DEFAULT '{}'
			);

			CREATE INDEX IF NOT EXISTS idx_memories_workspace ON conversation_memories(workspace_root);
			CREATE INDEX IF NOT EXISTS idx_memories_type ON conversation_memories(type);
			CREATE INDEX IF NOT EXISTS idx_memories_priority ON conversation_memories(priority);
			CREATE INDEX IF NOT EXISTS idx_memories_accessed ON conversation_memories(last_accessed_at);
			CREATE INDEX IF NOT EXISTS idx_memories_task ON conversation_memories(task_id);
		`)
	}

	private async loadRecentMemories(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		const rows = await db.all(
			`SELECT * FROM conversation_memories 
			ORDER BY last_accessed_at DESC 
			LIMIT ?`,
			[this.maxRecentMemories],
		)

		for (const row of rows) {
			const memory = this.rowToMemory(row)
			this.recentMemories.set(memory.id, memory)
		}
	}

	private addToRecentCache(memory: ConversationMemory): void {
		// Evict oldest if at capacity
		if (this.recentMemories.size >= this.maxRecentMemories) {
			let oldestKey: string | null = null
			let oldestTime = Infinity

			for (const [key, mem] of this.recentMemories) {
				if (mem.lastAccessedAt < oldestTime) {
					oldestTime = mem.lastAccessedAt
					oldestKey = key
				}
			}

			if (oldestKey) {
				this.recentMemories.delete(oldestKey)
			}
		}

		this.recentMemories.set(memory.id, memory)
	}

	private async saveToDatabase(memory: ConversationMemory): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		const embeddingBlob = memory.embedding ? Buffer.from(new Float64Array(memory.embedding).buffer) : null

		await db.run(
			`INSERT OR REPLACE INTO conversation_memories 
			(id, task_id, workspace_root, type, priority, title, summary, content, 
			embedding, tags, related_files, created_at, last_accessed_at, access_count, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				memory.id,
				memory.taskId,
				memory.workspaceRoot,
				memory.type,
				memory.priority,
				memory.title,
				memory.summary,
				memory.content,
				embeddingBlob,
				JSON.stringify(memory.tags),
				JSON.stringify(memory.relatedFiles),
				memory.createdAt,
				memory.lastAccessedAt,
				memory.accessCount,
				JSON.stringify(memory.metadata),
			],
		)
	}

	private async loadFromDatabase(id: string): Promise<ConversationMemory | null> {
		if (!this.databaseManager) return null

		const db = (this.databaseManager as any).db
		if (!db) return null

		const row = await db.get(`SELECT * FROM conversation_memories WHERE id = ?`, [id])

		return row ? this.rowToMemory(row) : null
	}

	private async updateAccessStats(id: string): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.run(
			`UPDATE conversation_memories 
			SET last_accessed_at = ?, access_count = access_count + 1 
			WHERE id = ?`,
			[Date.now(), id],
		)
	}

	private rowToMemory(row: any): ConversationMemory {
		return {
			id: row.id,
			taskId: row.task_id,
			workspaceRoot: row.workspace_root,
			type: row.type as MemoryType,
			priority: row.priority as MemoryPriority,
			title: row.title,
			summary: row.summary,
			content: row.content,
			embedding: row.embedding ? Array.from(new Float64Array(row.embedding)) : undefined,
			tags: JSON.parse(row.tags || "[]"),
			relatedFiles: JSON.parse(row.related_files || "[]"),
			createdAt: row.created_at,
			lastAccessedAt: row.last_accessed_at,
			accessCount: row.access_count,
			metadata: JSON.parse(row.metadata || "{}"),
		}
	}

	private searchInMemory(query: MemorySearchQuery): MemorySearchResult[] {
		const results: MemorySearchResult[] = []

		for (const memory of this.recentMemories.values()) {
			if (query.workspaceRoot && memory.workspaceRoot !== query.workspaceRoot) continue
			if (query.type && memory.type !== query.type) continue
			if (query.priority && memory.priority !== query.priority) continue

			let relevanceScore = 0.5
			if (query.query) {
				relevanceScore = this.calculateRelevance(memory, query.query)
				if (query.minRelevance && relevanceScore < query.minRelevance) continue
			}

			results.push({ memory, relevanceScore })
		}

		results.sort((a, b) => b.relevanceScore - a.relevanceScore)
		return results.slice(0, query.limit || 10)
	}

	private calculateRelevance(memory: ConversationMemory, query: string): number {
		const queryLower = query.toLowerCase()
		let score = 0

		// Title match (highest weight)
		if (memory.title.toLowerCase().includes(queryLower)) {
			score += 0.4
		}

		// Summary match
		if (memory.summary.toLowerCase().includes(queryLower)) {
			score += 0.3
		}

		// Content match
		if (memory.content.toLowerCase().includes(queryLower)) {
			score += 0.2
		}

		// Tag match
		if (memory.tags.some((tag) => tag.toLowerCase().includes(queryLower))) {
			score += 0.1
		}

		return Math.min(1, score)
	}

	private async pruneOldMemories(): Promise<number> {
		if (!this.databaseManager) return 0

		const db = (this.databaseManager as any).db
		if (!db) return 0

		const cutoffTime = Date.now() - this.config.pruneDays * 24 * 60 * 60 * 1000

		// Keep high priority memories longer
		const result = await db.run(
			`DELETE FROM conversation_memories 
			WHERE last_accessed_at < ? 
			AND priority NOT IN ('critical', 'high')
			AND access_count < 5`,
			[cutoffTime],
		)

		return result.changes || 0
	}
}

// Singleton instance
let memoryStoreInstance: ConversationMemoryStore | null = null

export function getConversationMemoryStore(config?: Partial<MemoryStoreConfig>): ConversationMemoryStore {
	if (!memoryStoreInstance) {
		memoryStoreInstance = new ConversationMemoryStore(config)
	}
	return memoryStoreInstance
}

export function resetConversationMemoryStore(): void {
	memoryStoreInstance = null
}
