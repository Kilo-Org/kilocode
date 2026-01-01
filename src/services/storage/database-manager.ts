// kilocode_change - new file

import { Database } from "sqlite3"
import { open, Database as SqliteDatabase } from "sqlite"
import path from "path"
import fs from "fs/promises"

export interface FileRecord {
	id: string
	path: string
	content_hash: string
	metadata: string
	created_at: string
	updated_at: string
}

export interface SymbolRecord {
	id: string
	name: string
	type: "class" | "function" | "method" | "variable" | "import"
	file_id: string
	start_line: number
	end_line: number
	parent_symbol_id?: string
	metadata: string
	created_at: string
	updated_at: string
}

export interface RelationshipRecord {
	id: string
	from_symbol_id: string
	to_symbol_id: string
	type: "CALLS" | "INHERITS" | "IMPORTS" | "REFERENCES"
	metadata?: string
	created_at: string
}

export interface CodeChunkRecord {
	id: string
	file_id: string
	symbol_id?: string
	content: string
	start_line: number
	end_line: number
	vector_embedding?: ArrayBuffer
	created_at: string
}

// kilocode_change - External context tables for integrations
export interface ExternalContextSourceRecord {
	id: string
	type: string // 'github' | 'jira' | 'slack'
	source_id: string // External ID
	title: string
	url: string
	author: string
	created_at: number
	updated_at: number
	content: string // Encrypted if sensitive
	encrypted: boolean
	metadata: string // JSON metadata
}

export interface ExternalCommentRecord {
	id: string
	discussion_id: string
	author: string
	content: string // Encrypted if sensitive
	encrypted: boolean
	created_at: number
	metadata: string // JSON metadata
}

export interface ExternalRelationshipRecord {
	id: string
	source_id: string // ExternalContextSource.id
	target_type: string // 'file' | 'symbol'
	target_id: string // File path or symbol ID
	relationship_type: string // 'mentions' | 'discusses' | 'implements' | 'references' | 'fixes'
	confidence: number // 0-1
	created_at: number
	metadata: string // JSON metadata
}

export class DatabaseManager {
	private db: SqliteDatabase | null = null
	private readonly dbPath: string
	private readonly workspacePath: string

	constructor(workspacePath: string, storageDir: string) {
		this.workspacePath = workspacePath
		const workspaceName = path.basename(workspacePath)
		this.dbPath = path.join(storageDir, `${workspaceName}-context.db`)
	}

	/**
	 * Initialize the database with WAL mode and create all tables
	 */
	async initialize(): Promise<void> {
		// Ensure storage directory exists
		await fs.mkdir(path.dirname(this.dbPath), { recursive: true })

		// Open database with WAL mode for better concurrent performance
		this.db = await open({
			filename: this.dbPath,
			driver: Database,
		})

		// Enable WAL mode for better concurrent read/write performance
		await this.db.exec("PRAGMA journal_mode=WAL")
		await this.db.exec("PRAGMA synchronous=NORMAL")
		await this.db.exec("PRAGMA cache_size=10000")
		await this.db.exec("PRAGMA temp_store=memory")

		// Create tables with proper indexing
		await this.createTables()
	}

	/**
	 * Create all database tables with proper indexes
	 */
	private async createTables(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		// Files table
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS files (
				id TEXT PRIMARY KEY,
				path TEXT UNIQUE NOT NULL,
				content_hash TEXT NOT NULL,
				metadata TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`)

		// Symbols table with Odoo-specific metadata support
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS symbols (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('class', 'function', 'method', 'variable', 'import')),
				file_id TEXT NOT NULL,
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				parent_symbol_id TEXT,
				metadata TEXT, -- JSON metadata including Odoo model names (_name, _inherit)
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
				FOREIGN KEY (parent_symbol_id) REFERENCES symbols(id) ON DELETE SET NULL
			)
		`)

		// Relationships table for code dependencies
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS relationships (
				id TEXT PRIMARY KEY,
				from_symbol_id TEXT NOT NULL,
				to_symbol_id TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('CALLS', 'INHERITS', 'IMPORTS', 'REFERENCES')),
				metadata TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (from_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE,
				FOREIGN KEY (to_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE,
				UNIQUE(from_symbol_id, to_symbol_id, type)
			)
		`)

		// Code chunks table with vector support
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS code_chunks (
				id TEXT PRIMARY KEY,
				file_id TEXT NOT NULL,
				symbol_id TEXT,
				content TEXT NOT NULL,
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				vector_embedding BLOB, -- 1536-dimensional vector for OpenAI text-embedding-3-small
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
				FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE SET NULL
			)
		`)

		// kilocode_change - External context tables
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS external_context_sources (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL CHECK (type IN ('github', 'jira', 'slack')),
				source_id TEXT NOT NULL,
				title TEXT NOT NULL,
				url TEXT NOT NULL,
				author TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				content TEXT NOT NULL, -- Encrypted if sensitive
				encrypted BOOLEAN NOT NULL DEFAULT 0,
				metadata TEXT, -- JSON metadata
				UNIQUE(type, source_id)
			)
		`)

		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS external_comments (
				id TEXT PRIMARY KEY,
				discussion_id TEXT NOT NULL,
				author TEXT NOT NULL,
				content TEXT NOT NULL, -- Encrypted if sensitive
				encrypted BOOLEAN NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				metadata TEXT, -- JSON metadata
				FOREIGN KEY (discussion_id) REFERENCES external_context_sources(id) ON DELETE CASCADE
			)
		`)

		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS external_relationships (
				id TEXT PRIMARY KEY,
				source_id TEXT NOT NULL,
				target_type TEXT NOT NULL CHECK (target_type IN ('file', 'symbol')),
				target_id TEXT NOT NULL,
				relationship_type TEXT NOT NULL CHECK (relationship_type IN ('mentions', 'discusses', 'implements', 'references', 'fixes')),
				confidence REAL NOT NULL,
				created_at INTEGER NOT NULL,
				metadata TEXT, -- JSON metadata
				FOREIGN KEY (source_id) REFERENCES external_context_sources(id) ON DELETE CASCADE
			)
		`)

		// Create indexes for performance
		await this.createIndexes()
	}

	/**
	 * Create database indexes for optimal query performance
	 */
	private async createIndexes(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		// Files indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash)")

		// Symbols indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_parent ON symbols(parent_symbol_id)")

		// Relationships indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_symbol_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_symbol_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type)")

		// Code chunks indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_code_chunks_file_id ON code_chunks(file_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_code_chunks_symbol_id ON code_chunks(symbol_id)")

		// kilocode_change - External context indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_external_sources_type ON external_context_sources(type)")
		await this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_external_sources_source_id ON external_context_sources(source_id)",
		)
		await this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_external_sources_updated ON external_context_sources(updated_at)",
		)
		await this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_external_comments_discussion ON external_comments(discussion_id)",
		)
		await this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_external_relationships_source ON external_relationships(source_id)",
		)
		await this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_external_relationships_target ON external_relationships(target_type, target_id)",
		)
	}

	/**
	 * Upsert a file record (create or update)
	 */
	async upsertFile(file: Omit<FileRecord, "created_at" | "updated_at">): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO files (id, path, content_hash, metadata, updated_at)
			VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		`,
			file.id,
			file.path,
			file.content_hash,
			file.metadata,
		)
	}

	/**
	 * Upsert a symbol record
	 */
	async upsertSymbol(symbol: Omit<SymbolRecord, "created_at" | "updated_at">): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO symbols (id, name, type, file_id, start_line, end_line, parent_symbol_id, metadata, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`,
			symbol.id,
			symbol.name,
			symbol.type,
			symbol.file_id,
			symbol.start_line,
			symbol.end_line,
			symbol.parent_symbol_id,
			symbol.metadata,
		)
	}

	/**
	 * Upsert a relationship record
	 */
	async upsertRelationship(relationship: Omit<RelationshipRecord, "created_at">): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO relationships (id, from_symbol_id, to_symbol_id, type, metadata)
			VALUES (?, ?, ?, ?, ?)
		`,
			relationship.id,
			relationship.from_symbol_id,
			relationship.to_symbol_id,
			relationship.type,
			relationship.metadata,
		)
	}

	/**
	 * Upsert a code chunk record with optional vector embedding
	 */
	async upsertCodeChunk(chunk: Omit<CodeChunkRecord, "created_at">): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO code_chunks (id, file_id, symbol_id, content, start_line, end_line, vector_embedding)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			chunk.id,
			chunk.file_id,
			chunk.symbol_id,
			chunk.content,
			chunk.start_line,
			chunk.end_line,
			chunk.vector_embedding,
		)
	}

	/**
	 * Delete all data associated with a file (cascade delete)
	 */
	async deleteFile(filePath: string): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run("DELETE FROM files WHERE path = ?", filePath)
	}

	/**
	 * Get symbol context including inheritance chain
	 */
	async getSymbolContext(symbolName: string): Promise<any> {
		if (!this.db) throw new Error("Database not initialized")

		const symbol = await this.db.get(
			`
			SELECT s.*, f.path as file_path
			FROM symbols s
			JOIN files f ON s.file_id = f.id
			WHERE s.name = ?
		`,
			symbolName,
		)

		if (!symbol) return null

		// Get inheritance chain
		const inheritanceChain = await this.db.all(
			`
			WITH RECURSIVE inheritance AS (
				SELECT s.*, 0 as level
				FROM symbols s
				WHERE s.id = ?
				
				UNION ALL
				
				SELECT s2.*, inheritance.level + 1
				FROM symbols s2
				JOIN relationships r ON s2.id = r.to_symbol_id
				JOIN inheritance ON r.from_symbol_id = inheritance.id
				WHERE r.type = 'INHERITS'
			)
			SELECT * FROM inheritance ORDER BY level
		`,
			symbol.id,
		)

		return {
			symbol,
			inheritanceChain,
		}
	}

	/**
	 * Find all files impacted by a changed symbol
	 */
	async findImpactedFiles(changedSymbolId: string): Promise<any[]> {
		if (!this.db) throw new Error("Database not initialized")

		const impacted = await this.db.all(
			`
			WITH RECURSIVE dependents AS (
				-- Direct dependents
				SELECT s.id, s.name, s.type, f.path as file_path, 1 as level
				FROM symbols s
				JOIN relationships r ON s.id = r.from_symbol_id
				JOIN files f ON s.file_id = f.id
				WHERE r.to_symbol_id = ?
				
				UNION ALL
				
				-- Indirect dependents
				SELECT s.id, s.name, s.type, f.path as file_path, dependents.level + 1
				FROM symbols s
				JOIN relationships r ON s.id = r.from_symbol_id
				JOIN files f ON s.file_id = f.id
				JOIN dependents ON r.to_symbol_id = dependents.id
				WHERE r.type IN ('CALLS', 'REFERENCES')
			)
			SELECT DISTINCT file_path, name, type, level
			FROM dependents
			ORDER BY level, file_path
		`,
			changedSymbolId,
		)

		return impacted
	}

	/**
	 * Perform vector similarity search (basic implementation)
	 * Note: For production, consider using sqlite-vss or LanceDB for better vector search
	 */
	async searchVectorContext(queryVector: number[], limit: number = 10): Promise<any[]> {
		if (!this.db) throw new Error("Database not initialized")

		// Basic vector similarity search (cosine similarity)
		// In production, this should use sqlite-vss or an external vector store
		const results = await this.db.all(
			`
			SELECT 
				cc.id,
				cc.content,
				cc.start_line,
				cc.end_line,
				f.path as file_path,
				s.name as symbol_name
			FROM code_chunks cc
			JOIN files f ON cc.file_id = f.id
			LEFT JOIN symbols s ON cc.symbol_id = s.id
			WHERE cc.vector_embedding IS NOT NULL
			ORDER BY random()
			LIMIT ?
		`,
			limit,
		)

		// TODO: Implement actual vector similarity calculation
		// This requires either sqlite-vss or custom cosine similarity calculation
		return results
	}

	/**
	 * Get Odoo model information from metadata
	 */
	async getOdooModelInfo(modelName: string): Promise<any> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT s.*, f.path as file_path
			FROM symbols s
			JOIN files f ON s.file_id = f.id
			WHERE s.type = 'class'
			AND (json_extract(s.metadata, '$._name') = ? OR json_extract(s.metadata, '$._inherit') LIKE ?)
		`,
			modelName,
			`%${modelName}%`,
		)
	}

	/**
	 * Clean up orphaned records
	 */
	async cleanupOrphanedRecords(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		// Clean up orphaned symbols
		await this.db.run("DELETE FROM symbols WHERE file_id NOT IN (SELECT id FROM files)")

		// Clean up orphaned relationships
		await this.db.run(`
			DELETE FROM relationships 
			WHERE from_symbol_id NOT IN (SELECT id FROM symbols) 
			OR to_symbol_id NOT IN (SELECT id FROM symbols)
		`)

		// Clean up orphaned code chunks
		await this.db.run(`
			DELETE FROM code_chunks 
			WHERE file_id NOT IN (SELECT id FROM files) 
			OR (symbol_id IS NOT NULL AND symbol_id NOT IN (SELECT id FROM symbols))
		`)
	}

	/**
	 * Close the database connection
	 */
	async close(): Promise<void> {
		if (this.db) {
			await this.db.close()
			this.db = null
		}
	}

	/**
	 * Get database statistics
	 */
	async getStats(): Promise<any> {
		if (!this.db) throw new Error("Database not initialized")

		const [files, symbols, relationships, chunks] = await Promise.all([
			this.db.get("SELECT COUNT(*) as count FROM files"),
			this.db.get("SELECT COUNT(*) as count FROM symbols"),
			this.db.get("SELECT COUNT(*) as count FROM relationships"),
			this.db.get("SELECT COUNT(*) as count FROM code_chunks"),
		])

		return {
			files: files.count,
			symbols: symbols.count,
			relationships: relationships.count,
			chunks: chunks.count,
		}
	}

	/**
	 * Get the underlying database instance (for advanced usage)
	 */
	getDatabase() {
		return this.db
	}

	// kilocode_change - External context CRUD methods

	/**
	 * Upsert an external context source
	 */
	async upsertExternalContextSource(
		source: Omit<ExternalContextSourceRecord, "created_at" | "updated_at">,
	): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO external_context_sources
			(id, type, source_id, title, url, author, created_at, updated_at, content, encrypted, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			source.id,
			source.type,
			source.source_id,
			source.title,
			source.url,
			source.author,
			source.created_at,
			source.updated_at,
			source.content,
			source.encrypted ? 1 : 0,
			source.metadata,
		)
	}

	/**
	 * Upsert an external comment
	 */
	async upsertExternalComment(comment: Omit<ExternalCommentRecord, "created_at">): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO external_comments
			(id, discussion_id, author, content, encrypted, created_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			comment.id,
			comment.discussion_id,
			comment.author,
			comment.content,
			comment.encrypted ? 1 : 0,
			comment.created_at,
			comment.metadata,
		)
	}

	/**
	 * Upsert an external relationship
	 */
	async upsertExternalRelationship(relationship: ExternalRelationshipRecord): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			INSERT OR REPLACE INTO external_relationships
			(id, source_id, target_type, target_id, relationship_type, confidence, created_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`,
			relationship.id,
			relationship.source_id,
			relationship.target_type,
			relationship.target_id,
			relationship.relationship_type,
			relationship.confidence,
			relationship.created_at,
			relationship.metadata,
		)
	}

	/**
	 * Get external context related to a file or symbol
	 */
	async getRelatedExternalContext(targetType: "file" | "symbol", targetId: string, limit = 10): Promise<any[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT
				ecs.id,
				ecs.type,
				ecs.source_id,
				ecs.title,
				ecs.url,
				ecs.author,
				ecs.content,
				ecs.encrypted,
				ecs.metadata,
				er.relationship_type,
				er.confidence
			FROM external_relationships er
			JOIN external_context_sources ecs ON er.source_id = ecs.id
			WHERE er.target_type = ? AND er.target_id = ?
			ORDER BY er.confidence DESC, ecs.updated_at DESC
			LIMIT ?
		`,
			targetType,
			targetId,
			limit,
		)
	}

	/**
	 * Get comments for an external discussion
	 */
	async getExternalComments(discussionId: string): Promise<any[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT id, author, content, encrypted, created_at, metadata
			FROM external_comments
			WHERE discussion_id = ?
			ORDER BY created_at ASC
		`,
			discussionId,
		)
	}

	/**
	 * Delete external context by source type and ID
	 */
	async deleteExternalContext(type: string, sourceId: string): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run("DELETE FROM external_context_sources WHERE type = ? AND source_id = ?", type, sourceId)
	}

	/**
	 * Get external context updated since a timestamp
	 */
	async getExternalContextSince(timestamp: number, type?: string): Promise<any[]> {
		if (!this.db) throw new Error("Database not initialized")

		if (type) {
			return await this.db.all(
				`
				SELECT * FROM external_context_sources
				WHERE type = ? AND updated_at >= ?
				ORDER BY updated_at DESC
			`,
				type,
				timestamp,
			)
		}

		return await this.db.all(
			`
			SELECT * FROM external_context_sources
			WHERE updated_at >= ?
			ORDER BY updated_at DESC
		`,
			timestamp,
		)
	}
}
