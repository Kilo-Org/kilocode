import * as vscode from "vscode"
import * as path from "path"
import { CodeChunker } from "../indexing/code-chunker"
import { VectorDatabase } from "../indexing/vector-database"
import { CacheManager } from "../cache/cache-manager"

/**
 * File watcher for automatic index updates
 * Monitors file changes and triggers re-indexing
 */
export class FileWatcher {
	private watchers: vscode.FileSystemWatcher[]
	private vectorDb: VectorDatabase
	private chunker: CodeChunker
	private cacheManager: CacheManager
	private indexQueue: Set<string>
	private indexTimer: NodeJS.Timeout | null
	private batchDelay: number

	constructor(vectorDb: VectorDatabase, chunker: CodeChunker, cacheManager: CacheManager) {
		this.watchers = []
		this.vectorDb = vectorDb
		this.chunker = chunker
		this.cacheManager = cacheManager
		this.indexQueue = new Set()
		this.indexTimer = null
		this.batchDelay = 5000 // 5 seconds
	}

	/**
	 * Start watching workspace folders
	 */
	async start(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
		for (const folder of workspaceFolders) {
			this.watchFolder(folder)
		}
	}

	/**
	 * Stop all watchers
	 */
	async stop(): Promise<void> {
		for (const watcher of this.watchers) {
			watcher.dispose()
		}
		this.watchers = []

		if (this.indexTimer) {
			clearTimeout(this.indexTimer)
			this.indexTimer = null
		}
	}

	private watchFolder(folder: vscode.WorkspaceFolder): void {
		// Watch all code files
		const patterns = [
			"**/*.ts",
			"**/*.tsx",
			"**/*.js",
			"**/*.jsx",
			"**/*.py",
			"**/*.java",
			"**/*.go",
			"**/*.rs",
			"**/*.cpp",
			"**/*.c",
			"**/*.h",
			"**/*.cs",
			"**/*.rb",
			"**/*.php",
		]

		for (const pattern of patterns) {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern))

			watcher.onDidCreate((uri) => this.onFileCreated(uri))
			watcher.onDidChange((uri) => this.onFileChanged(uri))
			watcher.onDidDelete((uri) => this.onFileDeleted(uri))

			this.watchers.push(watcher)
		}
	}

	private async onFileCreated(uri: vscode.Uri): Promise<void> {
		console.log(`File created: ${uri.fsPath}`)
		this.queueForIndexing(uri.fsPath)
	}

	private async onFileChanged(uri: vscode.Uri): Promise<void> {
		console.log(`File changed: ${uri.fsPath}`)

		// Invalidate caches for this file
		this.cacheManager.onFileModified(uri.fsPath)

		// Queue for re-indexing
		this.queueForIndexing(uri.fsPath)
	}

	private async onFileDeleted(uri: vscode.Uri): Promise<void> {
		console.log(`File deleted: ${uri.fsPath}`)

		// Invalidate caches
		this.cacheManager.onFileDeleted(uri.fsPath)

		// Remove from vector database
		await this.vectorDb.deleteByFilePath(uri.fsPath)
	}

	/**
	 * Queue a file for indexing (batched to avoid excessive processing)
	 */
	private queueForIndexing(filePath: string): void {
		this.indexQueue.add(filePath)

		// Reset timer
		if (this.indexTimer) {
			clearTimeout(this.indexTimer)
		}

		// Process queue after delay
		this.indexTimer = setTimeout(() => {
			this.processBatch()
		}, this.batchDelay)
	}

	/**
	 * Process queued files in batch
	 */
	private async processBatch(): Promise<void> {
		if (this.indexQueue.size === 0) {
			return
		}

		const filesToIndex = Array.from(this.indexQueue)
		this.indexQueue.clear()

		console.log(`Processing batch of ${filesToIndex.length} files`)

		for (const filePath of filesToIndex) {
			try {
				await this.indexFile(filePath)
			} catch (error) {
				console.error(`Failed to index file: ${filePath}`, error)
			}
		}
	}

	/**
	 * Index a single file
	 */
	private async indexFile(filePath: string): Promise<void> {
		try {
			// Read file content
			const uri = vscode.Uri.file(filePath)
			const content = await vscode.workspace.fs.readFile(uri)
			const contentStr = Buffer.from(content).toString("utf8")

			// Detect language
			const language = this.detectLanguage(filePath)

			// Chunk the file
			const chunks = await this.chunker.chunkFromAST(filePath, contentStr, language)

			// Delete old chunks for this file
			await this.vectorDb.deleteByFilePath(filePath)

			// Add new chunks
			await this.vectorDb.addChunks(chunks)

			console.log(`Indexed ${chunks.length} chunks from ${filePath}`)
		} catch (error) {
			console.error(`Error indexing file ${filePath}:`, error)
			throw error
		}
	}

	private detectLanguage(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase()

		const languageMap: Record<string, string> = {
			".ts": "typescript",
			".tsx": "typescript",
			".js": "javascript",
			".jsx": "javascript",
			".py": "python",
			".java": "java",
			".go": "go",
			".rs": "rust",
			".cpp": "cpp",
			".c": "c",
			".h": "c",
			".cs": "csharp",
			".rb": "ruby",
			".php": "php",
		}

		return languageMap[ext] || "unknown"
	}

	/**
	 * Get indexing queue status
	 */
	getQueueStatus(): { pending: number; files: string[] } {
		return {
			pending: this.indexQueue.size,
			files: Array.from(this.indexQueue),
		}
	}
}
