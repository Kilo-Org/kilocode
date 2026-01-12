// kilocode_change - new file

/**
 * Database Manager for Advanced AI Features
 *
 * Manages SQLite database operations for citation tracking, chat sessions,
 * edit plans, and Slack integration. Provides a unified interface for
 * all database interactions in the enhanced AI features.
 */

import * as path from "path"
import * as fs from "fs/promises"
import Database from "better-sqlite3"
import { randomUUID } from "crypto"

// ============================================================================
// Types
// ============================================================================

export interface DatabaseConfig {
	/** Path to the database file */
	dbPath?: string
	/** Whether to enable WAL mode for better concurrency */
	enableWAL?: boolean
	/** Whether to enable foreign key constraints */
	enableForeignKeys?: boolean
}

export interface ChatSessionRow {
	id: string
	user_id: string
	title: string
	created_at: string
	updated_at: string
	context_id?: string
	metadata?: string
}

export interface ChatMessageRow {
	id: string
	session_id: string
	role: "user" | "assistant"
	content: string
	timestamp: string
	metadata?: string
}

export interface CitationRow {
	id: string
	message_id: string
	source_type: "file" | "documentation" | "url"
	source_path: string
	start_line?: number
	end_line?: number
	snippet: string
	confidence: number
	metadata?: string
}

export interface EditPlanRow {
	id: string
	user_id: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	created_at: string
	updated_at: string
	metadata?: string
}

export interface EditStepRow {
	id: string
	plan_id: string
	order: number
	title: string
	type: "create" | "update" | "delete" | "move"
	description: string
	status: "pending" | "completed" | "skipped" | "failed"
	metadata?: string
}

export interface FileReferenceRow {
	id: string
	step_id: string
	file_path: string
	change_type: "create" | "update" | "delete"
	old_content?: string
	new_content?: string
	metadata?: string
}

export interface CompletionContextRow {
	id: string
	session_id?: string
	file_path: string
	position: number
	surrounding_code: string
	project_context: string
	semantic_context: string
	metadata?: string
}

export interface SlackIntegrationRow {
	id: string
	user_id: string
	workspace_id: string
	channel_id?: string
	bot_token: string
	user_token: string
	is_active: number
	created_at: string
	last_used?: string
	metadata?: string
}

export interface SharedMessageRow {
	id: string
	integration_id: string
	message_id?: string
	content: string
	channel_id: string
	timestamp: string
	response?: string
	metadata?: string
}

export interface DocumentationIndexRow {
	id: string
	package_name: string
	version: string
	source_type: "npm" | "pypi" | "cargo" | "maven"
	source_url: string
	indexed_at: string
	embeddings: string
	metadata?: string
}

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA_SQL = `
-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    context_id TEXT,
    metadata TEXT,
    FOREIGN KEY (context_id) REFERENCES completion_contexts(id)
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- Citations
CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('file', 'documentation', 'url')),
    source_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    snippet TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    metadata TEXT,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

-- Edit plans
CREATE TABLE IF NOT EXISTS edit_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in-progress', 'completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT
);

-- Edit steps
CREATE TABLE IF NOT EXISTS edit_steps (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('create', 'update', 'delete', 'move')),
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'failed')),
    metadata TEXT,
    FOREIGN KEY (plan_id) REFERENCES edit_plans(id) ON DELETE CASCADE
);

-- File references
CREATE TABLE IF NOT EXISTS file_references (
    id TEXT PRIMARY KEY,
    step_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
    old_content TEXT,
    new_content TEXT,
    metadata TEXT,
    FOREIGN KEY (step_id) REFERENCES edit_steps(id) ON DELETE CASCADE
);

-- Completion contexts
CREATE TABLE IF NOT EXISTS completion_contexts (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    file_path TEXT NOT NULL,
    position INTEGER NOT NULL,
    surrounding_code TEXT NOT NULL,
    project_context TEXT NOT NULL,
    semantic_context TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
);

-- Slack integrations
CREATE TABLE IF NOT EXISTS slack_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    channel_id TEXT,
    bot_token TEXT NOT NULL,
    user_token TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_used TEXT,
    metadata TEXT
);

-- Shared messages
CREATE TABLE IF NOT EXISTS shared_messages (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL,
    message_id TEXT,
    content TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    response TEXT,
    metadata TEXT,
    FOREIGN KEY (integration_id) REFERENCES slack_integrations(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
);

-- Documentation index
CREATE TABLE IF NOT EXISTS documentation_index (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    version TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('npm', 'pypi', 'cargo', 'maven')),
    source_url TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    embeddings TEXT NOT NULL,
    metadata TEXT
);
`

const INDEXES_SQL = `
-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_citations_message_id ON citations(message_id);
CREATE INDEX IF NOT EXISTS idx_citations_source_path ON citations(source_path);
CREATE INDEX IF NOT EXISTS idx_edit_plans_user_id ON edit_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_edit_plans_status ON edit_plans(status);
CREATE INDEX IF NOT EXISTS idx_edit_steps_plan_id ON edit_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_edit_steps_order ON edit_steps(plan_id, "order");
CREATE INDEX IF NOT EXISTS idx_file_references_step_id ON file_references(step_id);
CREATE INDEX IF NOT EXISTS idx_completion_contexts_session_id ON completion_contexts(session_id);
CREATE INDEX IF NOT EXISTS idx_completion_contexts_file_path ON completion_contexts(file_path);
CREATE INDEX IF NOT EXISTS idx_slack_integrations_user_id ON slack_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_messages_integration_id ON shared_messages(integration_id);
CREATE INDEX IF NOT EXISTS idx_shared_messages_timestamp ON shared_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_documentation_index_package_name ON documentation_index(package_name);
CREATE INDEX IF NOT EXISTS idx_documentation_index_source_type ON documentation_index(source_type);
`

// ============================================================================
// Database Manager Class
// ============================================================================

export class DatabaseManager {
	private db: Database.Database | null = null
	private config: Required<DatabaseConfig>

	constructor(config: DatabaseConfig = {}) {
		this.config = {
			dbPath: config.dbPath || path.join(process.cwd(), ".kilo-code", "database", "ai-features.db"),
			enableWAL: config.enableWAL ?? true,
			enableForeignKeys: config.enableForeignKeys ?? true,
		}
	}

	/**
	 * Initialize the database connection and create schema
	 */
	async initialize(): Promise<void> {
		try {
			// Ensure directory exists
			const dbDir = path.dirname(this.config.dbPath)
			await fs.mkdir(dbDir, { recursive: true })

			// Open database connection
			this.db = new Database(this.config.dbPath)

			// Configure database
			if (this.config.enableForeignKeys) {
				this.db.pragma("foreign_keys = ON")
			}

			if (this.config.enableWAL) {
				this.db.pragma("journal_mode = WAL")
			}

			// Create schema
			this.db.exec(SCHEMA_SQL)
			this.db.exec(INDEXES_SQL)

			console.log(`[DatabaseManager] Database initialized at ${this.config.dbPath}`)
		} catch (error) {
			console.error("[DatabaseManager] Failed to initialize database:", error)
			throw error
		}
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		if (this.db) {
			this.db.close()
			this.db = null
			console.log("[DatabaseManager] Database connection closed")
		}
	}

	/**
	 * Get the underlying database instance (for advanced usage)
	 */
	getDatabase(): Database.Database | null {
		return this.db
	}

	// ============================================================================
	// Citation Tracking Operations
	// ============================================================================

	/**
	 * Create a new citation
	 */
	createCitation(citation: Omit<CitationRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO citations (id, message_id, source_type, source_path, start_line, end_line, snippet, confidence, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			citation.message_id,
			citation.source_type,
			citation.source_path,
			citation.start_line || null,
			citation.end_line || null,
			citation.snippet,
			citation.confidence,
			citation.metadata || null,
		)

		return id
	}

	/**
	 * Get citations for a message
	 */
	getCitationsByMessageId(messageId: string): CitationRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM citations WHERE message_id = ?")
		return stmt.all(messageId) as CitationRow[]
	}

	/**
	 * Get citations by source path
	 */
	getCitationsBySourcePath(sourcePath: string): CitationRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM citations WHERE source_path = ?")
		return stmt.all(sourcePath) as CitationRow[]
	}

	/**
	 * Delete citations for a message
	 */
	deleteCitationsByMessageId(messageId: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM citations WHERE message_id = ?")
		const result = stmt.run(messageId)
		return result.changes
	}

	// ============================================================================
	// Chat Session Operations
	// ============================================================================

	/**
	 * Create a new chat session
	 */
	createChatSession(session: Omit<ChatSessionRow, "id" | "created_at" | "updated_at">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()
		const now = new Date().toISOString()

		const stmt = this.db.prepare(`
			INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, context_id, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(id, session.user_id, session.title, now, now, session.context_id || null, session.metadata || null)

		return id
	}

	/**
	 * Get a chat session by ID
	 */
	getChatSession(id: string): ChatSessionRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM chat_sessions WHERE id = ?")
		return stmt.get(id) as ChatSessionRow | null
	}

	/**
	 * Get all chat sessions for a user
	 */
	getChatSessionsByUserId(userId: string): ChatSessionRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC")
		return stmt.all(userId) as ChatSessionRow[]
	}

	/**
	 * Update chat session
	 */
	updateChatSession(id: string, updates: Partial<Omit<ChatSessionRow, "id" | "created_at">>): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const now = new Date().toISOString()
		const fields: string[] = []
		const values: any[] = []

		if (updates.title !== undefined) {
			fields.push("title = ?")
			values.push(updates.title)
		}
		if (updates.context_id !== undefined) {
			fields.push("context_id = ?")
			values.push(updates.context_id)
		}
		if (updates.metadata !== undefined) {
			fields.push("metadata = ?")
			values.push(updates.metadata)
		}

		if (fields.length === 0) {
			return
		}

		fields.push("updated_at = ?")
		values.push(now)
		values.push(id)

		const stmt = this.db.prepare(`UPDATE chat_sessions SET ${fields.join(", ")} WHERE id = ?`)
		stmt.run(...values)
	}

	/**
	 * Delete a chat session
	 */
	deleteChatSession(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM chat_sessions WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Chat Message Operations
	// ============================================================================

	/**
	 * Create a new chat message
	 */
	createChatMessage(message: Omit<ChatMessageRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO chat_messages (id, session_id, role, content, timestamp, metadata)
			VALUES (?, ?, ?, ?, ?, ?)
		`)

		stmt.run(id, message.session_id, message.role, message.content, message.timestamp, message.metadata || null)

		return id
	}

	/**
	 * Get messages for a session
	 */
	getChatMessagesBySessionId(sessionId: string): ChatMessageRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC")
		return stmt.all(sessionId) as ChatMessageRow[]
	}

	/**
	 * Get a chat message by ID
	 */
	getChatMessage(id: string): ChatMessageRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM chat_messages WHERE id = ?")
		return stmt.get(id) as ChatMessageRow | null
	}

	/**
	 * Delete a chat message
	 */
	deleteChatMessage(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM chat_messages WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Completion Context Operations
	// ============================================================================

	/**
	 * Create a completion context
	 */
	createCompletionContext(context: Omit<CompletionContextRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO completion_contexts (id, session_id, file_path, position, surrounding_code, project_context, semantic_context, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			context.session_id || null,
			context.file_path,
			context.position,
			context.surrounding_code,
			context.project_context,
			context.semantic_context,
			context.metadata || null,
		)

		return id
	}

	/**
	 * Get a completion context by ID
	 */
	getCompletionContext(id: string): CompletionContextRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM completion_contexts WHERE id = ?")
		return stmt.get(id) as CompletionContextRow | null
	}

	/**
	 * Get completion contexts for a session
	 */
	getCompletionContextsBySessionId(sessionId: string): CompletionContextRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM completion_contexts WHERE session_id = ?")
		return stmt.all(sessionId) as CompletionContextRow[]
	}

	/**
	 * Update completion context
	 */
	updateCompletionContext(id: string, updates: Partial<Omit<CompletionContextRow, "id">>): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const fields: string[] = []
		const values: any[] = []

		if (updates.file_path !== undefined) {
			fields.push("file_path = ?")
			values.push(updates.file_path)
		}
		if (updates.position !== undefined) {
			fields.push("position = ?")
			values.push(updates.position)
		}
		if (updates.surrounding_code !== undefined) {
			fields.push("surrounding_code = ?")
			values.push(updates.surrounding_code)
		}
		if (updates.project_context !== undefined) {
			fields.push("project_context = ?")
			values.push(updates.project_context)
		}
		if (updates.semantic_context !== undefined) {
			fields.push("semantic_context = ?")
			values.push(updates.semantic_context)
		}
		if (updates.metadata !== undefined) {
			fields.push("metadata = ?")
			values.push(updates.metadata)
		}

		if (fields.length === 0) {
			return
		}

		values.push(id)

		const stmt = this.db.prepare(`UPDATE completion_contexts SET ${fields.join(", ")} WHERE id = ?`)
		stmt.run(...values)
	}

	/**
	 * Delete a completion context
	 */
	deleteCompletionContext(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM completion_contexts WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Edit Plan Operations
	// ============================================================================

	/**
	 * Create a new edit plan
	 */
	createEditPlan(plan: Omit<EditPlanRow, "id" | "created_at" | "updated_at">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()
		const now = new Date().toISOString()

		const stmt = this.db.prepare(`
			INSERT INTO edit_plans (id, user_id, title, description, status, created_at, updated_at, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(id, plan.user_id, plan.title, plan.description, plan.status, now, now, plan.metadata || null)

		return id
	}

	/**
	 * Get an edit plan by ID
	 */
	getEditPlan(id: string): EditPlanRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM edit_plans WHERE id = ?")
		return stmt.get(id) as EditPlanRow | null
	}

	/**
	 * Get all edit plans for a user
	 */
	getEditPlansByUserId(userId: string): EditPlanRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM edit_plans WHERE user_id = ? ORDER BY created_at DESC")
		return stmt.all(userId) as EditPlanRow[]
	}

	/**
	 * Update edit plan status
	 */
	updateEditPlanStatus(id: string, status: EditPlanRow["status"]): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const now = new Date().toISOString()
		const stmt = this.db.prepare("UPDATE edit_plans SET status = ?, updated_at = ? WHERE id = ?")
		stmt.run(status, now, id)
	}

	/**
	 * Update edit plan
	 */
	updateEditPlan(id: string, updates: Partial<Omit<EditPlanRow, "id" | "user_id" | "created_at">>): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const now = new Date().toISOString()
		const fields: string[] = []
		const values: any[] = []

		if (updates.title !== undefined) {
			fields.push("title = ?")
			values.push(updates.title)
		}
		if (updates.description !== undefined) {
			fields.push("description = ?")
			values.push(updates.description)
		}
		if (updates.status !== undefined) {
			fields.push("status = ?")
			values.push(updates.status)
		}
		if (updates.metadata !== undefined) {
			fields.push("metadata = ?")
			values.push(updates.metadata)
		}

		if (fields.length === 0) {
			return
		}

		fields.push("updated_at = ?")
		values.push(now)
		values.push(id)

		const stmt = this.db.prepare(`UPDATE edit_plans SET ${fields.join(", ")} WHERE id = ?`)
		stmt.run(...values)
	}

	/**
	 * Delete an edit plan
	 */
	deleteEditPlan(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM edit_plans WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Edit Step Operations
	// ============================================================================

	/**
	 * Create a new edit step
	 */
	createEditStep(step: Omit<EditStepRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO edit_steps (id, plan_id, "order", title, type, description, status, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			step.plan_id,
			step.order,
			step.title,
			step.type,
			step.description,
			step.status,
			step.metadata || null,
		)

		return id
	}

	/**
	 * Get steps for a plan
	 */
	getEditStepsByPlanId(planId: string): EditStepRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare('SELECT * FROM edit_steps WHERE plan_id = ? ORDER BY "order" ASC')
		return stmt.all(planId) as EditStepRow[]
	}

	/**
	 * Update edit step status
	 */
	updateEditStepStatus(id: string, status: EditStepRow["status"]): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("UPDATE edit_steps SET status = ? WHERE id = ?")
		stmt.run(status, id)
	}

	/**
	 * Update edit step
	 */
	updateEditStep(id: string, updates: Partial<Omit<EditStepRow, "id" | "plan_id">>): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const fields: string[] = []
		const values: any[] = []

		if (updates.order !== undefined) {
			fields.push('"order" = ?')
			values.push(updates.order)
		}
		if (updates.title !== undefined) {
			fields.push("title = ?")
			values.push(updates.title)
		}
		if (updates.type !== undefined) {
			fields.push("type = ?")
			values.push(updates.type)
		}
		if (updates.description !== undefined) {
			fields.push("description = ?")
			values.push(updates.description)
		}
		if (updates.status !== undefined) {
			fields.push("status = ?")
			values.push(updates.status)
		}
		if (updates.metadata !== undefined) {
			fields.push("metadata = ?")
			values.push(updates.metadata)
		}

		if (fields.length === 0) {
			return
		}

		values.push(id)

		const stmt = this.db.prepare(`UPDATE edit_steps SET ${fields.join(", ")} WHERE id = ?`)
		stmt.run(...values)
	}

	/**
	 * Delete an edit step
	 */
	deleteEditStep(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM edit_steps WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// File Reference Operations
	// ============================================================================

	/**
	 * Create a new file reference
	 */
	createFileReference(reference: Omit<FileReferenceRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO file_references (id, step_id, file_path, change_type, old_content, new_content, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			reference.step_id,
			reference.file_path,
			reference.change_type,
			reference.old_content || null,
			reference.new_content || null,
			reference.metadata || null,
		)

		return id
	}

	/**
	 * Get file references for a step
	 */
	getFileReferencesByStepId(stepId: string): FileReferenceRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM file_references WHERE step_id = ?")
		return stmt.all(stepId) as FileReferenceRow[]
	}

	/**
	 * Delete file references for a step
	 */
	deleteFileReferencesByStepId(stepId: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM file_references WHERE step_id = ?")
		const result = stmt.run(stepId)
		return result.changes
	}

	// ============================================================================
	// Slack Integration Operations
	// ============================================================================

	/**
	 * Create a new Slack integration
	 */
	createSlackIntegration(integration: Omit<SlackIntegrationRow, "id" | "created_at">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()
		const now = new Date().toISOString()

		const stmt = this.db.prepare(`
			INSERT INTO slack_integrations (id, user_id, workspace_id, channel_id, bot_token, user_token, is_active, created_at, last_used, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			integration.user_id,
			integration.workspace_id,
			integration.channel_id || null,
			integration.bot_token,
			integration.user_token,
			integration.is_active ? 1 : 0,
			now,
			integration.last_used || null,
			integration.metadata || null,
		)

		return id
	}

	/**
	 * Get a Slack integration by ID
	 */
	getSlackIntegration(id: string): SlackIntegrationRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM slack_integrations WHERE id = ?")
		return stmt.get(id) as SlackIntegrationRow | null
	}

	/**
	 * Get all Slack integrations for a user
	 */
	getSlackIntegrationsByUserId(userId: string): SlackIntegrationRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM slack_integrations WHERE user_id = ?")
		return stmt.all(userId) as SlackIntegrationRow[]
	}

	/**
	 * Update Slack integration last used timestamp
	 */
	updateSlackIntegrationLastUsed(id: string): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const now = new Date().toISOString()
		const stmt = this.db.prepare("UPDATE slack_integrations SET last_used = ? WHERE id = ?")
		stmt.run(now, id)
	}

	/**
	 * Update Slack integration active status
	 */
	updateSlackIntegrationActive(id: string, isActive: boolean): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("UPDATE slack_integrations SET is_active = ? WHERE id = ?")
		stmt.run(isActive ? 1 : 0, id)
	}

	/**
	 * Delete a Slack integration
	 */
	deleteSlackIntegration(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM slack_integrations WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Shared Message Operations
	// ============================================================================

	/**
	 * Create a new shared message
	 */
	createSharedMessage(message: Omit<SharedMessageRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO shared_messages (id, integration_id, message_id, content, channel_id, timestamp, response, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			message.integration_id,
			message.message_id || null,
			message.content,
			message.channel_id,
			message.timestamp,
			message.response || null,
			message.metadata || null,
		)

		return id
	}

	/**
	 * Get shared messages for an integration
	 */
	getSharedMessagesByIntegrationId(integrationId: string): SharedMessageRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM shared_messages WHERE integration_id = ? ORDER BY timestamp DESC")
		return stmt.all(integrationId) as SharedMessageRow[]
	}

	/**
	 * Delete shared messages for an integration
	 */
	deleteSharedMessagesByIntegrationId(integrationId: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM shared_messages WHERE integration_id = ?")
		const result = stmt.run(integrationId)
		return result.changes
	}

	// ============================================================================
	// Documentation Index Operations
	// ============================================================================

	/**
	 * Create a new documentation index entry
	 */
	createDocumentationIndex(index: Omit<DocumentationIndexRow, "id">): string {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const id = randomUUID()

		const stmt = this.db.prepare(`
			INSERT INTO documentation_index (id, package_name, version, source_type, source_url, indexed_at, embeddings, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)

		stmt.run(
			id,
			index.package_name,
			index.version,
			index.source_type,
			index.source_url,
			index.indexed_at,
			index.embeddings,
			index.metadata || null,
		)

		return id
	}

	/**
	 * Get documentation index by package name and version
	 */
	getDocumentationIndex(packageName: string, version: string): DocumentationIndexRow | null {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("SELECT * FROM documentation_index WHERE package_name = ? AND version = ?")
		return stmt.get(packageName, version) as DocumentationIndexRow | null
	}

	/**
	 * Get all documentation indices for a package
	 */
	getDocumentationIndicesByPackageName(packageName: string): DocumentationIndexRow[] {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare(
			"SELECT * FROM documentation_index WHERE package_name = ? ORDER BY indexed_at DESC",
		)
		return stmt.all(packageName) as DocumentationIndexRow[]
	}

	/**
	 * Delete a documentation index
	 */
	deleteDocumentationIndex(id: string): number {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stmt = this.db.prepare("DELETE FROM documentation_index WHERE id = ?")
		const result = stmt.run(id)
		return result.changes
	}

	// ============================================================================
	// Utility Operations
	// ============================================================================

	/**
	 * Execute a transaction
	 */
	async transaction<T>(fn: () => T): Promise<T> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const transaction = this.db.transaction(fn)
		return transaction()
	}

	/**
	 * Get database statistics
	 */
	getStats(): Record<string, number> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const stats: Record<string, number> = {}

		stats.chat_sessions = this.db.prepare("SELECT COUNT(*) as count FROM chat_sessions").get() as any
		stats.chat_messages = this.db.prepare("SELECT COUNT(*) as count FROM chat_messages").get() as any
		stats.citations = this.db.prepare("SELECT COUNT(*) as count FROM citations").get() as any
		stats.edit_plans = this.db.prepare("SELECT COUNT(*) as count FROM edit_plans").get() as any
		stats.edit_steps = this.db.prepare("SELECT COUNT(*) as count FROM edit_steps").get() as any
		stats.file_references = this.db.prepare("SELECT COUNT(*) as count FROM file_references").get() as any
		stats.completion_contexts = this.db.prepare("SELECT COUNT(*) as count FROM completion_contexts").get() as any
		stats.slack_integrations = this.db.prepare("SELECT COUNT(*) as count FROM slack_integrations").get() as any
		stats.shared_messages = this.db.prepare("SELECT COUNT(*) as count FROM shared_messages").get() as any
		stats.documentation_index = this.db.prepare("SELECT COUNT(*) as count FROM documentation_index").get() as any

		return stats
	}

	/**
	 * Clear all data (for testing purposes)
	 */
	clearAll(): void {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		this.db.exec("DELETE FROM citations")
		this.db.exec("DELETE FROM chat_messages")
		this.db.exec("DELETE FROM chat_sessions")
		this.db.exec("DELETE FROM file_references")
		this.db.exec("DELETE FROM edit_steps")
		this.db.exec("DELETE FROM edit_plans")
		this.db.exec("DELETE FROM completion_contexts")
		this.db.exec("DELETE FROM shared_messages")
		this.db.exec("DELETE FROM slack_integrations")
		this.db.exec("DELETE FROM documentation_index")

		console.log("[DatabaseManager] All data cleared")
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: DatabaseManager | null = null

export function getDatabaseManager(config?: DatabaseConfig): DatabaseManager {
	if (!instance) {
		instance = new DatabaseManager(config)
	}
	return instance
}

export function resetDatabaseManager(): void {
	if (instance) {
		instance.close()
		instance = null
	}
}
