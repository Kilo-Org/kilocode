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

// kilocode_change - QA State persistence tables
export interface QASessionRecord {
	id: string
	workspace_root: string
	started_at: number
	completed_at?: number
	status: "running" | "completed" | "failed" | "cancelled"
	total_tests: number
	passed_tests: number
	failed_tests: number
	skipped_tests: number
	coverage_percentage: number
	privacy_mode: boolean
	ai_provider: string
	metadata: string // JSON metadata
}

export interface QATestRecord {
	id: string
	session_id: string
	file_path: string
	operation: "generate_tests" | "run_diagnostics" | "check_coverage" | "validate_manifest" | "security_audit"
	status: "pending" | "running" | "completed" | "failed" | "skipped"
	started_at: number
	completed_at?: number
	duration_ms?: number
	confidence: number
	result_data?: string // JSON result data
	error_message?: string
	test_count?: number
	metadata: string // JSON metadata
	coverage_lines?: number
	security_score?: number
}

export interface EditHistoryRecord {
	id: string
	message_id: string
	timestamp: number
	affected_files: string // JSON array of file paths
	reverse_patches: string // JSON array of reverse diffs
	original_snapshots: string // JSON array of original file contents
	metadata: string // JSON metadata including operation type, user context
	is_reverted: boolean
	reverted_at?: number
	reverted_by?: string // User or system that initiated revert
	conflict_resolution?: string // JSON for conflict resolution data
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
				relationship_type TEXT NOT NULL,
				confidence REAL NOT NULL,
				created_at INTEGER NOT NULL,
				metadata TEXT, -- JSON metadata
				FOREIGN KEY (source_id) REFERENCES external_context_sources(id) ON DELETE CASCADE
			)
		`)

		// kilocode_change - QA State persistence tables
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS qa_sessions (
				id TEXT PRIMARY KEY,
				workspace_root TEXT NOT NULL,
				started_at INTEGER NOT NULL,
				completed_at INTEGER,
				status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
				total_tests INTEGER NOT NULL DEFAULT 0,
				passed_tests INTEGER NOT NULL DEFAULT 0,
				failed_tests INTEGER NOT NULL DEFAULT 0,
				skipped_tests INTEGER NOT NULL DEFAULT 0,
				coverage_percentage REAL NOT NULL DEFAULT 0,
				privacy_mode BOOLEAN NOT NULL DEFAULT 0,
				ai_provider TEXT,
				metadata TEXT -- JSON metadata
			)
		`)

		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS qa_tests (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				file_path TEXT NOT NULL,
				operation TEXT NOT NULL CHECK (operation IN ('generate_tests', 'run_diagnostics', 'check_coverage', 'validate_manifest', 'security_audit')),
				status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
				started_at INTEGER NOT NULL,
				completed_at INTEGER,
				duration_ms INTEGER,
				confidence REAL NOT NULL DEFAULT 0,
				result_data TEXT, -- JSON result data
				error_message TEXT,
				test_count INTEGER,
				coverage_lines INTEGER,
				security_score INTEGER,
				FOREIGN KEY (session_id) REFERENCES qa_sessions(id) ON DELETE CASCADE
			)
		`)

		// kilocode_change - Edit History table for atomic revert
		await this.db.exec(`
			CREATE TABLE IF NOT EXISTS edit_history (
				id TEXT PRIMARY KEY,
				message_id TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				affected_files TEXT NOT NULL, -- JSON array of file paths
				reverse_patches TEXT NOT NULL, -- JSON array of reverse diffs
				original_snapshots TEXT NOT NULL, -- JSON array of original file contents
				metadata TEXT, -- JSON metadata including operation type, user context
				is_reverted BOOLEAN DEFAULT 0,
				reverted_at INTEGER,
				reverted_by TEXT, -- User or system that initiated revert
				conflict_resolution TEXT -- JSON for conflict resolution data
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

		// kilocode_change - QA State indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_sessions_workspace ON qa_sessions(workspace_root)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_sessions_status ON qa_sessions(status)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_sessions_started ON qa_sessions(started_at)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_tests_session ON qa_tests(session_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_tests_file ON qa_tests(file_path)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_tests_operation ON qa_tests(operation)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_qa_tests_status ON qa_tests(status)")

		// kilocode_change - Edit History indexes
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_edit_history_message ON edit_history(message_id)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_edit_history_timestamp ON edit_history(timestamp)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_edit_history_reverted ON edit_history(is_reverted)")
		await this.db.exec("CREATE INDEX IF NOT EXISTS idx_edit_history_files ON edit_history(affected_files)")
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
	async upsertExternalContextSource(source: ExternalContextSourceRecord): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		const now = Date.now()
		const record: ExternalContextSourceRecord = {
			...source,
			created_at: source.created_at || now,
			updated_at: now,
		}

		await this.db.run(
			`
			INSERT OR REPLACE INTO external_context_sources
			(id, type, source_id, title, url, author, created_at, updated_at, content, encrypted, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			record.id,
			record.type,
			record.source_id,
			record.title,
			record.url,
			record.author,
			record.created_at,
			record.updated_at,
			record.content,
			record.encrypted ? 1 : 0,
			record.metadata,
		)
	}

	/**
	 * Upsert an external comment
	 */
	async upsertExternalComment(comment: ExternalCommentRecord): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		const record: ExternalCommentRecord = {
			...comment,
			created_at: comment.created_at || Date.now(),
		}

		await this.db.run(
			`
			INSERT OR REPLACE INTO external_comments
			(id, discussion_id, author, content, encrypted, created_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			record.id,
			record.discussion_id,
			record.author,
			record.content,
			record.encrypted ? 1 : 0,
			record.created_at,
			record.metadata,
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

	// kilocode_change - QA State persistence methods

	/**
	 * Create a new QA session
	 */
	async createQASession(session: Omit<QASessionRecord, "id">): Promise<string> {
		if (!this.db) throw new Error("Database not initialized")

		const id = `qa_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		await this.db.run(
			`
			INSERT INTO qa_sessions (
				id, workspace_root, started_at, status, total_tests, passed_tests, 
				failed_tests, skipped_tests, coverage_percentage, privacy_mode, ai_provider, metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			id,
			session.workspace_root,
			session.started_at,
			session.status,
			session.total_tests,
			session.passed_tests,
			session.failed_tests,
			session.skipped_tests,
			session.coverage_percentage,
			session.privacy_mode ? 1 : 0,
			session.ai_provider,
			session.metadata,
		)

		return id
	}

	/**
	 * Update QA session status and metrics
	 */
	async updateQASession(id: string, updates: Partial<QASessionRecord>): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		const fields = []
		const values = []

		if (updates.status !== undefined) {
			fields.push("status = ?")
			values.push(updates.status)
		}
		if (updates.completed_at !== undefined) {
			fields.push("completed_at = ?")
			values.push(updates.completed_at)
		}
		if (updates.total_tests !== undefined) {
			fields.push("total_tests = ?")
			values.push(updates.total_tests)
		}
		if (updates.passed_tests !== undefined) {
			fields.push("passed_tests = ?")
			values.push(updates.passed_tests)
		}
		if (updates.failed_tests !== undefined) {
			fields.push("failed_tests = ?")
			values.push(updates.failed_tests)
		}
		if (updates.skipped_tests !== undefined) {
			fields.push("skipped_tests = ?")
			values.push(updates.skipped_tests)
		}
		if (updates.coverage_percentage !== undefined) {
			fields.push("coverage_percentage = ?")
			values.push(updates.coverage_percentage)
		}
		if (updates.privacy_mode !== undefined) {
			fields.push("privacy_mode = ?")
			values.push(updates.privacy_mode ? 1 : 0)
		}
		if (updates.ai_provider !== undefined) {
			fields.push("ai_provider = ?")
			values.push(updates.ai_provider)
		}
		if (updates.metadata !== undefined) {
			fields.push("metadata = ?")
			values.push(updates.metadata)
		}

		if (fields.length === 0) return

		values.push(id)
		await this.db.run(`UPDATE qa_sessions SET ${fields.join(", ")} WHERE id = ?`, ...values)
	}

	/**
	 * Create a new QA test record
	 */
	async createQATest(test: Omit<QATestRecord, "id">): Promise<string> {
		if (!this.db) throw new Error("Database not initialized")

		const id = `qa_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		await this.db.run(
			`
			INSERT INTO qa_tests (
				id, session_id, file_path, operation, status, started_at, completed_at,
				duration_ms, confidence, result_data, error_message, test_count, 
				issues_found, coverage_lines, security_score
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			id,
			test.session_id,
			test.file_path,
			test.operation,
			test.status,
			test.started_at,
			test.completed_at,
			test.duration_ms,
			test.confidence,
			test.result_data,
			test.error_message,
			test.test_count,
			test.issues_found,
			test.coverage_lines,
			test.security_score,
		)

		return id
	}

	/**
	 * Update QA test status and results
	 */
	async updateQATest(id: string, updates: Partial<QATestRecord>): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		const fields = []
		const values = []

		if (updates.status !== undefined) {
			fields.push("status = ?")
			values.push(updates.status)
		}
		if (updates.completed_at !== undefined) {
			fields.push("completed_at = ?")
			values.push(updates.completed_at)
		}
		if (updates.duration_ms !== undefined) {
			fields.push("duration_ms = ?")
			values.push(updates.duration_ms)
		}
		if (updates.confidence !== undefined) {
			fields.push("confidence = ?")
			values.push(updates.confidence)
		}
		if (updates.result_data !== undefined) {
			fields.push("result_data = ?")
			values.push(updates.result_data)
		}
		if (updates.error_message !== undefined) {
			fields.push("error_message = ?")
			values.push(updates.error_message)
		}
		if (updates.test_count !== undefined) {
			fields.push("test_count = ?")
			values.push(updates.test_count)
		}
		if (updates.issues_found !== undefined) {
			fields.push("issues_found = ?")
			values.push(updates.issues_found)
		}
		if (updates.coverage_lines !== undefined) {
			fields.push("coverage_lines = ?")
			values.push(updates.coverage_lines)
		}
		if (updates.security_score !== undefined) {
			fields.push("security_score = ?")
			values.push(updates.security_score)
		}

		if (fields.length === 0) return

		values.push(id)
		await this.db.run(`UPDATE qa_tests SET ${fields.join(", ")} WHERE id = ?`, ...values)
	}

	/**
	 * Get recent QA sessions for a workspace
	 */
	async getQASessions(workspaceRoot: string, limit: number = 10): Promise<QASessionRecord[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT * FROM qa_sessions 
			WHERE workspace_root = ? 
			ORDER BY started_at DESC 
			LIMIT ?
		`,
			workspaceRoot,
			limit,
		)
	}

	/**
	 * Get QA tests for a session
	 */
	async getQATests(sessionId: string): Promise<QATestRecord[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT * FROM qa_tests 
			WHERE session_id = ? 
			ORDER BY started_at ASC
		`,
			sessionId,
		)
	}

	/**
	 * Get latest QA session for a workspace
	 */
	async getLatestQASession(workspaceRoot: string): Promise<QASessionRecord | null> {
		if (!this.db) throw new Error("Database not initialized")

		const sessions = await this.db.all(
			`
			SELECT * FROM qa_sessions 
			WHERE workspace_root = ? 
			ORDER BY started_at DESC 
			LIMIT 1
		`,
			workspaceRoot,
		)

		return sessions.length > 0 ? sessions[0] : null
	}

	// kilocode_change - Edit History methods

	/**
	 * Save edit history record for atomic revert
	 */
	async saveEditHistory(editHistory: Omit<EditHistoryRecord, "id">): Promise<string> {
		if (!this.db) throw new Error("Database not initialized")

		const id = `edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		await this.db.run(
			`
			INSERT INTO edit_history 
			(id, message_id, timestamp, affected_files, reverse_patches, original_snapshots, metadata, is_reverted, reverted_at, reverted_by, conflict_resolution)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			id,
			editHistory.message_id,
			editHistory.timestamp,
			editHistory.affected_files,
			editHistory.reverse_patches,
			editHistory.original_snapshots,
			editHistory.metadata,
			editHistory.is_reverted ? 1 : 0,
			editHistory.reverted_at,
			editHistory.reverted_by,
			editHistory.conflict_resolution,
		)

		return id
	}

	/**
	 * Get edit history by message ID
	 */
	async getEditHistoryByMessageId(messageId: string): Promise<EditHistoryRecord[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT * FROM edit_history 
			WHERE message_id = ? 
			ORDER BY timestamp DESC
		`,
			messageId,
		)
	}

	/**
	 * Get edit history by ID
	 */
	async getEditHistoryById(id: string): Promise<EditHistoryRecord | null> {
		if (!this.db) throw new Error("Database not initialized")

		const records = await this.db.all(
			`
			SELECT * FROM edit_history 
			WHERE id = ?
		`,
			id,
		)

		return records.length > 0 ? records[0] : null
	}

	/**
	 * Mark edit history as reverted
	 */
	async markEditHistoryAsReverted(id: string, revertedBy: string): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			UPDATE edit_history 
			SET is_reverted = 1, reverted_at = ?, reverted_by = ?
			WHERE id = ?
		`,
			Date.now(),
			revertedBy,
			id,
		)
	}

	/**
	 * Get recent edit history
	 */
	async getRecentEditHistory(limit: number = 50): Promise<EditHistoryRecord[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT * FROM edit_history 
			ORDER BY timestamp DESC 
			LIMIT ?
		`,
			limit,
		)
	}

	/**
	 * Get edit history for file
	 */
	async getEditHistoryForFile(filePath: string, limit: number = 20): Promise<EditHistoryRecord[]> {
		if (!this.db) throw new Error("Database not initialized")

		return await this.db.all(
			`
			SELECT * FROM edit_history 
			WHERE json_extract(affected_files, '$') LIKE ?
			ORDER BY timestamp DESC 
			LIMIT ?
		`,
			`%${filePath}%`,
			limit,
		)
	}

	/**
	 * Delete edit history record
	 */
	async deleteEditHistory(id: string): Promise<void> {
		if (!this.db) throw new Error("Database not initialized")

		await this.db.run(
			`
			DELETE FROM edit_history 
			WHERE id = ?
		`,
			id,
		)
	}

	/**
	 * Clean up old edit history (older than specified days)
	 */
	async cleanupOldEditHistory(daysOld: number = 30): Promise<number> {
		if (!this.db) throw new Error("Database not initialized")

		const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000

		const result = await this.db.run(
			`
			DELETE FROM edit_history 
			WHERE timestamp < ? AND is_reverted = 1
		`,
			cutoffTime,
		)

		return result.changes || 0
	}
}
