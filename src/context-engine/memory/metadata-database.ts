import * as sqlite3 from "better-sqlite3"
import type { MemoryEntry, MemoryType } from "../types"
import * as fs from "fs"
import * as path from "path"

/**
 * Metadata database using SQLite
 * Stores memory, relationships, and metadata
 */
export class MetadataDatabase {
	private dbPath: string
	private db: sqlite3.Database | null

	constructor(dbPath: string) {
		this.dbPath = dbPath
		this.db = null
	}

	/**
	 * Initialize the database and create tables
	 */
	async initialize(): Promise<void> {
		// Ensure directory exists
		const dbDir = path.dirname(this.dbPath)
		if (!fs.existsSync(dbDir)) {
			fs.mkdirSync(dbDir, { recursive: true })
		}

		// Open database
		const Database = require("better-sqlite3")
		this.db = new Database(this.dbPath)

		// Create tables
		this.createTables()

		// Set up indices for performance
		this.createIndices()
	}

	private createTables(): void {
		if (!this.db) return

		// Memory table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS memory (
				id TEXT PRIMARY KEY,
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				type TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				ttl INTEGER,
				metadata TEXT
			)
		`)

		// Chunk metadata table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chunk_metadata (
				chunk_id TEXT PRIMARY KEY,
				file_path TEXT NOT NULL,
				symbol_name TEXT,
				parent_symbol TEXT,
				imports TEXT,
				exports TEXT,
				dependencies TEXT,
				framework TEXT,
				last_modified INTEGER NOT NULL
			)
		`)

		// Relationships table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS relationships (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source_chunk_id TEXT NOT NULL,
				target_identifier TEXT NOT NULL,
				type TEXT NOT NULL,
				target_file_path TEXT,
				metadata TEXT
			)
		`)

		// Query analytics table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS query_analytics (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				query TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				latency INTEGER NOT NULL,
				results_count INTEGER NOT NULL,
				cache_hit INTEGER NOT NULL,
				sources TEXT
			)
		`)

		// Schema version table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			)
		`)

		// Insert initial schema version
		const stmt = this.db.prepare("INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)")
		stmt.run(1, Date.now())
	}

	private createIndices(): void {
		if (!this.db) return

		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);
			CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
			CREATE INDEX IF NOT EXISTS idx_chunk_metadata_file ON chunk_metadata(file_path);
			CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_chunk_id);
			CREATE INDEX IF NOT EXISTS idx_query_analytics_timestamp ON query_analytics(timestamp);
		`)
	}

	/**
	 * Store a memory entry
	 */
	async setMemory(entry: MemoryEntry): Promise<void> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO memory (id, key, value, type, timestamp, ttl, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			entry.id,
			entry.key,
			JSON.stringify(entry.value),
			entry.type,
			entry.timestamp,
			entry.ttl || null,
			entry.metadata ? JSON.stringify(entry.metadata) : null,
		)
	}

	/**
	 * Get a memory entry by key
	 */
	async getMemory(key: string, type?: MemoryType): Promise<MemoryEntry | null> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		let stmt
		if (type) {
			stmt = this.db.prepare("SELECT * FROM memory WHERE key = ? AND type = ? ORDER BY timestamp DESC LIMIT 1")
		} else {
			stmt = this.db.prepare("SELECT * FROM memory WHERE key = ? ORDER BY timestamp DESC LIMIT 1")
		}

		const row = type ? stmt.get(key, type) : stmt.get(key)

		if (!row) {
			return null
		}

		return this.rowToMemoryEntry(row as any)
	}

	/**
	 * Get all memory entries of a specific type
	 */
	async getMemoriesByType(type: MemoryType): Promise<MemoryEntry[]> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM memory WHERE type = ? ORDER BY timestamp DESC")
		const rows = stmt.all(type)

		return rows.map((row) => this.rowToMemoryEntry(row as any))
	}

	/**
	 * Delete expired memory entries
	 */
	async cleanupExpiredMemory(): Promise<number> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const now = Date.now()
		const stmt = this.db.prepare("DELETE FROM memory WHERE ttl IS NOT NULL AND (timestamp + ttl) < ?")
		const result = stmt.run(now)

		return result.changes
	}

	/**
	 * Clear all memory of a specific type
	 */
	async clearMemoryByType(type: MemoryType): Promise<void> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM memory WHERE type = ?")
		stmt.run(type)
	}

	/**
	 * Record query analytics
	 */
	async recordQuery(
		query: string,
		latency: number,
		resultsCount: number,
		cacheHit: boolean,
		sources: string[],
	): Promise<void> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare(`
			INSERT INTO query_analytics (query, timestamp, latency, results_count, cache_hit, sources)
			VALUES (?, ?, ?, ?, ?, ?)
		`)

		stmt.run(query, Date.now(), latency, resultsCount, cacheHit ? 1 : 0, JSON.stringify(sources))
	}

	/**
	 * Get query analytics statistics
	 */
	async getQueryStats(): Promise<{
		totalQueries: number
		avgLatency: number
		cacheHitRate: number
		recentQueries: any[]
	}> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM query_analytics")
		const total = totalStmt.get() as any

		const avgStmt = this.db.prepare("SELECT AVG(latency) as avg FROM query_analytics")
		const avg = avgStmt.get() as any

		const cacheStmt = this.db.prepare(
			"SELECT SUM(cache_hit) * 1.0 / COUNT(*) as rate FROM query_analytics WHERE timestamp > ?",
		)
		const cacheRate = cacheStmt.get(Date.now() - 3600000) as any // Last hour

		const recentStmt = this.db.prepare("SELECT * FROM query_analytics ORDER BY timestamp DESC LIMIT 100")
		const recent = recentStmt.all()

		return {
			totalQueries: total.count,
			avgLatency: avg.avg || 0,
			cacheHitRate: cacheRate.rate || 0,
			recentQueries: recent,
		}
	}

	private rowToMemoryEntry(row: any): MemoryEntry {
		return {
			id: row.id,
			key: row.key,
			value: JSON.parse(row.value),
			type: row.type,
			timestamp: row.timestamp,
			ttl: row.ttl,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}
	}

	/**
	 * Close the database
	 */
	async close(): Promise<void> {
		if (this.db) {
			this.db.close()
			this.db = null
		}
	}

	/**
	 * Get database file size
	 */
	async getSize(): Promise<number> {
		if (fs.existsSync(this.dbPath)) {
			const stats = fs.statSync(this.dbPath)
			return stats.size
		}
		return 0
	}
}
