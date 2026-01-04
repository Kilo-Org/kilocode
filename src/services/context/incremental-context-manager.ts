// kilocode_change - new file

import { DatabaseManager } from "../storage/database-manager"
import { ParserService } from "../parser/parser-service"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

export interface DirtyFile {
	filePath: string
	lastCommitHash: string
	currentHash: string
	changedLines: number[]
	isDeleted: boolean
	isNew: boolean
}

export interface ContextChunk {
	id: string
	filePath: string
	content: string
	startLine: number
	endLine: number
	embedding?: number[]
	lastModified: number
	size: number
}

export interface IncrementalIndexingStats {
	totalFiles: number
	dirtyFiles: number
	cleanFiles: number
	newFiles: number
	deletedFiles: number
	indexingTime: number
	memoryUsage: number
}

/**
 * High-performance incremental context management with dirty-file tracking
 */
export class IncrementalContextManager {
	private databaseManager: DatabaseManager
	private parserService: ParserService
	private fileHashCache: Map<string, string> = new Map()
	private contextCache: Map<string, ContextChunk[]> = new Map()
	private maxCacheSize = 1000 // Max files to cache
	private maxChunkSize = 1000 // Max lines per chunk
	private isInitialized = false

	constructor(databaseManager: DatabaseManager, parserService: ParserService) {
		this.databaseManager = databaseManager
		this.parserService = parserService
	}

	/**
	 * Initialize the incremental context manager
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		console.log("[IncrementalContextManager] Initializing dirty-file tracking")

		// Create tracking tables
		await this.createTrackingTables()

		// Load existing file hashes
		await this.loadFileHashes()

		this.isInitialized = true
		console.log("[IncrementalContextManager] Initialized successfully")
	}

	/**
	 * Scan for dirty files since last indexing
	 */
	async scanDirtyFiles(workspaceRoot: string): Promise<DirtyFile[]> {
		if (!this.isInitialized) {
			throw new Error("IncrementalContextManager not initialized")
		}

		console.log("[IncrementalContextManager] Scanning for dirty files")
		const startTime = Date.now()

		try {
			// Get current git commit hash
			const { stdout: currentCommit } = await execAsync("git rev-parse HEAD", {
				cwd: workspaceRoot,
			})
			const currentHash = currentCommit.trim()

			// Get all tracked files
			const { stdout: filesOutput } = await execAsync("git ls-files", {
				cwd: workspaceRoot,
			})
			const trackedFiles = filesOutput.trim().split("\n").filter(Boolean)

			// Get changed files since last commit
			const { stdout: changedOutput } = await execAsync("git diff --name-only HEAD~1 HEAD", {
				cwd: workspaceRoot,
			})
			const changedFiles = changedOutput.trim().split("\n").filter(Boolean)

			// Get untracked files
			const { stdout: untrackedOutput } = await execAsync("git ls-files --others --exclude-standard", {
				cwd: workspaceRoot,
			})
			const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean)

			const dirtyFiles: DirtyFile[] = []

			// Process changed files
			for (const filePath of changedFiles) {
				const fullPath = path.join(workspaceRoot, filePath)
				const currentHash = await this.getFileHash(fullPath)
				const lastCommitHash = await this.getLastCommitHash(workspaceRoot, filePath)

				const changedLines = await this.getChangedLines(workspaceRoot, filePath)

				dirtyFiles.push({
					filePath: fullPath,
					lastCommitHash,
					currentHash,
					changedLines,
					isDeleted: false,
					isNew: false,
				})
			}

			// Process new files
			for (const filePath of untrackedFiles) {
				const fullPath = path.join(workspaceRoot, filePath)
				const currentHash = await this.getFileHash(fullPath)

				dirtyFiles.push({
					filePath: fullPath,
					lastCommitHash: "",
					currentHash,
					changedLines: [], // All lines are new
					isDeleted: false,
					isNew: true,
				})
			}

			console.log(
				`[IncrementalContextManager] Found ${dirtyFiles.length} dirty files in ${Date.now() - startTime}ms`,
			)
			return dirtyFiles
		} catch (error) {
			console.error("[IncrementalContextManager] Error scanning dirty files:", error)
			throw error
		}
	}

	/**
	 * Index dirty files incrementally
	 */
	async indexDirtyFiles(dirtyFiles: DirtyFile[]): Promise<IncrementalIndexingStats> {
		if (!this.isInitialized) {
			throw new Error("IncrementalContextManager not initialized")
		}

		console.log(`[IncrementalContextManager] Indexing ${dirtyFiles.length} dirty files`)
		const startTime = Date.now()
		const startMemory = process.memoryUsage().heapUsed

		const stats: IncrementalIndexingStats = {
			totalFiles: dirtyFiles.length,
			dirtyFiles: 0,
			cleanFiles: 0,
			newFiles: 0,
			deletedFiles: 0,
			indexingTime: 0,
			memoryUsage: 0,
		}

		try {
			for (const dirtyFile of dirtyFiles) {
				if (dirtyFile.isDeleted) {
					await this.handleDeletedFile(dirtyFile.filePath)
					stats.deletedFiles++
				} else if (dirtyFile.isNew) {
					await this.handleNewFile(dirtyFile.filePath)
					stats.newFiles++
				} else {
					await this.handleChangedFile(dirtyFile.filePath, dirtyFile.changedLines)
					stats.dirtyFiles++
				}
			}

			// Update statistics
			stats.indexingTime = Date.now() - startTime
			stats.memoryUsage = process.memoryUsage().heapUsed - startMemory

			console.log(
				`[IncrementalContextManager] Indexed ${stats.dirtyFiles + stats.newFiles} files in ${stats.indexingTime}ms`,
			)
			return stats
		} catch (error) {
			console.error("[IncrementalContextManager] Error indexing dirty files:", error)
			throw error
		}
	}

	/**
	 * Get context chunks for a file (from cache or disk)
	 */
	async getContextChunks(filePath: string): Promise<ContextChunk[]> {
		if (!this.isInitialized) {
			throw new Error("IncrementalContextManager not initialized")
		}

		// Check cache first
		if (this.contextCache.has(filePath)) {
			return this.contextCache.get(filePath)!
		}

		// Load from database
		const chunks = await this.loadContextChunks(filePath)

		// Cache if within size limits
		if (this.contextCache.size < this.maxCacheSize) {
			this.contextCache.set(filePath, chunks)
		}

		return chunks
	}

	/**
	 * Get relevant context chunks based on cursor position
	 */
	async getRelevantContext(filePath: string, line: number, radius: number = 50): Promise<ContextChunk[]> {
		const chunks = await this.getContextChunks(filePath)

		// Find chunks that overlap with the cursor position
		const relevantChunks = chunks.filter(
			(chunk) => chunk.startLine <= line + radius && chunk.endLine >= line - radius,
		)

		// Sort by proximity to cursor
		return relevantChunks.sort((a, b) => {
			const aDistance = Math.min(Math.abs(a.startLine - line), Math.abs(a.endLine - line))
			const bDistance = Math.min(Math.abs(b.startLine - line), Math.abs(b.endLine - line))
			return aDistance - bDistance
		})
	}

	/**
	 * Clear context cache
	 */
	clearCache(): void {
		this.contextCache.clear()
		console.log("[IncrementalContextManager] Context cache cleared")
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): any {
		return {
			cachedFiles: this.contextCache.size,
			maxCacheSize: this.maxCacheSize,
			fileHashesCached: this.fileHashCache.size,
			memoryUsage: process.memoryUsage().heapUsed,
		}
	}

	// Private methods

	private async createTrackingTables(): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) throw new Error("Database not available")

		await db.exec(`
      CREATE TABLE IF NOT EXISTS file_tracking (
        file_path TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        last_commit_hash TEXT,
        last_modified INTEGER NOT NULL,
        indexed_at INTEGER DEFAULT CURRENT_TIMESTAMP
      )
    `)

		await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_tracking_path 
      ON file_tracking(file_path)
    `)

		await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_tracking_modified 
      ON file_tracking(last_modified)
    `)
	}

	private async loadFileHashes(): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) return

		const rows = await db.all("SELECT file_path, file_hash FROM file_tracking")

		for (const row of rows as Array<{ file_path: string; file_hash: string }>) {
			this.fileHashCache.set(row.file_path, row.file_hash)
		}

		console.log(`[IncrementalContextManager] Loaded ${this.fileHashCache.size} file hashes`)
	}

	private async getFileHash(filePath: string): Promise<string> {
		// Check cache first
		if (this.fileHashCache.has(filePath)) {
			return this.fileHashCache.get(filePath)!
		}

		try {
			const { stdout } = await execAsync(`git hash-object "${filePath}"`)
			const hash = stdout.trim()
			this.fileHashCache.set(filePath, hash)
			return hash
		} catch (error) {
			console.error(`[IncrementalContextManager] Error getting hash for ${filePath}:`, error)
			return ""
		}
	}

	private async getLastCommitHash(workspaceRoot: string, filePath: string): Promise<string> {
		try {
			const { stdout } = await execAsync(`git log -1 --format=%H -- "${filePath}"`, {
				cwd: workspaceRoot,
			})
			return stdout.trim()
		} catch (error) {
			console.error(`[IncrementalContextManager] Error getting last commit for ${filePath}:`, error)
			return ""
		}
	}

	private async getChangedLines(workspaceRoot: string, filePath: string): Promise<number[]> {
		try {
			const { stdout } = await execAsync(`git diff --unified=0 HEAD~1 HEAD -- "${filePath}"`, {
				cwd: workspaceRoot,
			})

			const changedLines: number[] = []
			const lines = stdout.split("\n")

			for (const line of lines) {
				if (line.startsWith("@@")) {
					const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
					if (match) {
						changedLines.push(parseInt(match[1]))
					}
				}
			}

			return changedLines
		} catch (error) {
			console.error(`[IncrementalContextManager] Error getting changed lines for ${filePath}:`, error)
			return []
		}
	}

	private async handleDeletedFile(filePath: string): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) return

		// Remove from tracking
		await db.run("DELETE FROM file_tracking WHERE file_path = ?", filePath)

		// Remove from caches
		this.fileHashCache.delete(filePath)
		this.contextCache.delete(filePath)

		console.log(`[IncrementalContextManager] Deleted file: ${filePath}`)
	}

	private async handleNewFile(filePath: string): Promise<void> {
		// Parse the new file
		const result = await this.parserService.parseFile(filePath)

		if (result.success) {
			// Create context chunks
			const chunks = await this.createContextChunks(filePath, result)

			// Save to database
			await this.saveContextChunks(chunks)

			// Update tracking
			await this.updateFileTracking(filePath)

			console.log(`[IncrementalContextManager] Indexed new file: ${filePath} (${chunks.length} chunks)`)
		}
	}

	private async handleChangedFile(filePath: string, changedLines: number[]): Promise<void> {
		// Only re-parse if there are significant changes
		if (changedLines.length > 0) {
			const result = await this.parserService.parseFile(filePath, { force: true })

			if (result.success) {
				// Update only affected chunks
				await this.updateAffectedChunks(filePath, changedLines, result)

				// Update tracking
				await this.updateFileTracking(filePath)

				console.log(
					`[IncrementalContextManager] Updated changed file: ${filePath} (${changedLines.length} lines)`,
				)
			}
		}
	}

	private async createContextChunks(filePath: string, parseResult: any): Promise<ContextChunk[]> {
		const chunks: ContextChunk[] = []

		// Read file content
		const fs = await import("fs/promises")
		const content = await fs.readFile(filePath, "utf8")
		const lines = content.split("\n")

		// Create chunks based on symbols or line ranges
		for (const symbol of parseResult.symbols) {
			const chunk: ContextChunk = {
				id: `${filePath}:${symbol.startLine}-${symbol.endLine}`,
				filePath,
				content: lines.slice(symbol.startLine - 1, symbol.endLine).join("\n"),
				startLine: symbol.startLine,
				endLine: symbol.endLine,
				lastModified: Date.now(),
				size: symbol.endLine - symbol.startLine + 1,
			}
			chunks.push(chunk)
		}

		return chunks
	}

	private async saveContextChunks(chunks: ContextChunk[]): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) return

		for (const chunk of chunks) {
			await db.run(
				`
        INSERT OR REPLACE INTO context_chunks 
        (id, file_path, content, start_line, end_line, last_modified, size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
				chunk.id,
				chunk.filePath,
				chunk.content,
				chunk.startLine,
				chunk.endLine,
				chunk.lastModified,
				chunk.size,
			)
		}
	}

	private async loadContextChunks(filePath: string): Promise<ContextChunk[]> {
		const db = this.databaseManager.getDatabase()
		if (!db) return []

		const rows = await db.all("SELECT * FROM context_chunks WHERE file_path = ? ORDER BY start_line", filePath)

		return rows.map((row) => ({
			id: row.id,
			filePath: row.file_path,
			content: row.content,
			startLine: row.start_line,
			endLine: row.end_line,
			lastModified: row.last_modified,
			size: row.size,
		}))
	}

	private async updateAffectedChunks(filePath: string, changedLines: number[], parseResult: any): Promise<void> {
		// Remove affected chunks
		const db = this.databaseManager.getDatabase()
		if (!db) return

		for (const line of changedLines) {
			await db.run(
				`
        DELETE FROM context_chunks 
        WHERE file_path = ? AND start_line <= ? AND end_line >= ?
      `,
				filePath,
				line,
				line,
			)
		}

		// Recreate chunks for affected areas
		const newChunks = await this.createContextChunks(filePath, parseResult)
		await this.saveContextChunks(newChunks)

		// Update cache
		this.contextCache.delete(filePath)
	}

	private async updateFileTracking(filePath: string): Promise<void> {
		const db = this.databaseManager.getDatabase()
		if (!db) return

		const fileHash = await this.getFileHash(filePath)
		const lastModified = Date.now()

		await db.run(
			`
      INSERT OR REPLACE INTO file_tracking 
      (file_path, file_hash, last_modified)
      VALUES (?, ?, ?)
    `,
			filePath,
			fileHash,
			lastModified,
		)
	}
}
