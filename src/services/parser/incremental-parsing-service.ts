// kilocode_change - new file

import { ParserService } from "../parser/parser-service"
import { DatabaseManager } from "../storage/database-manager"
import { FileWatcher } from "../code-index/processors"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Integration service that connects ParserService with the file watcher for incremental parsing
 */
export class IncrementalParsingService {
	private parserService: ParserService
	private databaseManager: DatabaseManager
	private fileWatcher: FileWatcher
	private isInitialized = false
	private parseQueue: Set<string> = new Set()
	private parseTimeout: NodeJS.Timeout | null = null

	constructor(parserService: ParserService, databaseManager: DatabaseManager, fileWatcher: FileWatcher) {
		this.parserService = parserService
		this.databaseManager = databaseManager
		this.fileWatcher = fileWatcher
	}

	/**
	 * Initialize the incremental parsing service
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		// Set up file change listeners using existing FileWatcher events
		this.setupFileChangeListeners()

		this.isInitialized = true
		console.log("[IncrementalParsingService] Initialized")
	}

	/**
	 * Handle file changes for incremental parsing
	 */
	private setupFileChangeListeners(): void {
		// Listen for batch processing events from FileWatcher
		this.fileWatcher.onDidStartBatchProcessing((files: string[]) => {
			console.log(`[IncrementalParsingService] Batch processing started for ${files.length} files`)
		})

		this.fileWatcher.onBatchProgressUpdate((progress) => {
			// Could be used for UI updates
			if (progress.currentFile) {
				console.log(
					`[IncrementalParsingService] Processing: ${progress.currentFile} (${progress.processedInBatch}/${progress.totalInBatch})`,
				)
			}
		})

		this.fileWatcher.onDidFinishBatchProcessing(async (summary) => {
			console.log(
				`[IncrementalParsingService] Batch processing completed: ${summary.processedFiles.length} files`,
			)

			// Clean up orphaned records after successful batch
			if (summary.processedFiles.length > 0) {
				await this.cleanupOrphanedRecords()
			}
		})
	}

	/**
	 * Queue a file for parsing with debouncing
	 */
	async queueFileForParsing(filePath: string, operation: "added" | "changed"): Promise<void> {
		// Add to queue
		this.parseQueue.add(filePath)

		// Debounce parsing to avoid excessive parsing during rapid file changes
		if (this.parseTimeout) {
			clearTimeout(this.parseTimeout)
		}

		this.parseTimeout = setTimeout(async () => {
			await this.processParseQueue()
		}, 500) // 500ms debounce
	}

	/**
	 * Process the parse queue
	 */
	private async processParseQueue(): Promise<void> {
		if (this.parseQueue.size === 0) {
			return
		}

		const filesToParse = Array.from(this.parseQueue)
		this.parseQueue.clear()

		console.log(`[IncrementalParsingService] Processing ${filesToParse.length} files for incremental parsing`)

		const startTime = Date.now()
		let successCount = 0
		let errorCount = 0

		for (const filePath of filesToParse) {
			try {
				const result = await this.parserService.parseFile(filePath, { force: true })

				if (result.success) {
					successCount++
					console.log(
						`[IncrementalParsingService] Successfully parsed ${filePath} (${result.symbols.length} symbols)`,
					)
				} else {
					errorCount++
					console.error(`[IncrementalParsingService] Failed to parse ${filePath}: ${result.error}`)
				}

				// Emit telemetry
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					filePath,
					success: result.success,
					symbolsCount: result.symbols.length,
					relationshipsCount: result.relationships.length,
					parseTime: result.parseTime,
					location: "incremental_parsing",
				})
			} catch (error) {
				errorCount++
				console.error(`[IncrementalParsingService] Error parsing ${filePath}:`, error)
			}
		}

		const totalTime = Date.now() - startTime
		console.log(
			`[IncrementalParsingService] Batch parsing completed: ${successCount} success, ${errorCount} errors, ${totalTime}ms`,
		)

		// Clean up orphaned records after batch parsing
		if (successCount > 0) {
			await this.cleanupOrphanedRecords()
		}
	}

	/**
	 * Handle file deletion
	 */
	private async handleFileDeletion(filePath: string): Promise<void> {
		try {
			console.log(`[IncrementalParsingService] Deleting file from database: ${filePath}`)
			await this.databaseManager.deleteFile(filePath)

			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				filePath,
				location: "incremental_parsing_file_deletion",
			})
		} catch (error) {
			console.error(`[IncrementalParsingService] Error deleting file ${filePath}:`, error)
		}
	}

	/**
	 * Handle batch operations (like workspace-wide changes)
	 */
	private async handleBatchOperation(operation: string, files: string[]): Promise<void> {
		console.log(`[IncrementalParsingService] Handling batch operation: ${operation} with ${files.length} files`)

		switch (operation) {
			case "workspace_cleared":
				// Clear all parsed data
				await this.handleWorkspaceCleared()
				break
			case "workspace_loaded":
				// Parse all files in workspace
				await this.handleWorkspaceLoaded(files)
				break
			case "directory_changed":
				// Re-parse files in changed directory
				await this.handleDirectoryChanged(files)
				break
			default:
				console.log(`[IncrementalParsingService] Unknown batch operation: ${operation}`)
		}
	}

	/**
	 * Handle workspace cleared operation
	 */
	private async handleWorkspaceCleared(): Promise<void> {
		try {
			console.log("[IncrementalParsingService] Clearing all parsed data from database")

			// Clear parser cache
			this.parserService.clearCache()

			// Clean up database
			await this.cleanupOrphanedRecords()
		} catch (error) {
			console.error("[IncrementalParsingService] Error handling workspace cleared:", error)
		}
	}

	/**
	 * Handle workspace loaded operation
	 */
	private async handleWorkspaceLoaded(files: string[]): Promise<void> {
		try {
			console.log(`[IncrementalParsingService] Loading workspace with ${files.length} files`)

			// Parse files in batches to avoid overwhelming the system
			const batchSize = 50
			for (let i = 0; i < files.length; i += batchSize) {
				const batch = files.slice(i, i + batchSize)
				await this.parserService.parseFiles(batch, { force: true })

				// Small delay between batches to prevent blocking
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
		} catch (error) {
			console.error("[IncrementalParsingService] Error handling workspace loaded:", error)
		}
	}

	/**
	 * Handle directory changed operation
	 */
	private async handleDirectoryChanged(files: string[]): Promise<void> {
		try {
			console.log(`[IncrementalParsingService] Re-parsing ${files.length} files in changed directory`)

			// Force re-parse all files in the directory
			await this.parserService.parseFiles(files, { force: true })
		} catch (error) {
			console.error("[IncrementalParsingService] Error handling directory changed:", error)
		}
	}

	/**
	 * Clean up orphaned records in the database
	 */
	private async cleanupOrphanedRecords(): Promise<void> {
		try {
			console.log("[IncrementalParsingService] Cleaning up orphaned records")
			await this.databaseManager.cleanupOrphanedRecords()
		} catch (error) {
			console.error("[IncrementalParsingService] Error cleaning up orphaned records:", error)
		}
	}

	/**
	 * Get parsing statistics
	 */
	getStats(): any {
		return {
			isInitialized: this.isInitialized,
			queueSize: this.parseQueue.size,
			parserStats: this.parserService.getStats(),
		}
	}

	/**
	 * Dispose of resources
	 */
	async dispose(): Promise<void> {
		// Clear any pending parse timeout
		if (this.parseTimeout) {
			clearTimeout(this.parseTimeout)
			this.parseTimeout = null
		}

		// Clear queue
		this.parseQueue.clear()

		// Dispose parser service
		await this.parserService.dispose()

		this.isInitialized = false
		console.log("[IncrementalParsingService] Disposed")
	}
}
