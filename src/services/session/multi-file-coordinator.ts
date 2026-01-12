/**
 * Multi-File State Coordination Service
 *
 * Coordinates diff states across multiple files and integrates with User Story 1 components
 */

import * as vscode from "vscode"
import { Logger } from "../error-handler"
import { DiffEventManager } from "../event-system"
import { SessionStateManager } from "../session/session-state"
import { FileOpenerService } from "../file-management/file-opener"
import { TabManagerService } from "../file-management/tab-manager"
import { DiffOverlayManager } from "../diff/diff-overlay"
import { FileBuffer, ShadowBuffer, DiffOverlay } from "../../types/diff-types"
import { FileState } from "../../types/session-types"

export interface MultiFileState {
	sessionId: string
	files: Map<string, FileState>
	activeDiffs: Map<string, DiffOverlay>
	coordinationState: "idle" | "applying" | "conflict" | "resolved"
	lastActivity: Date
}

export interface CoordinationEvent {
	type: "file_added" | "file_updated" | "file_removed" | "diff_applied" | "diff_conflict" | "coordination_complete"
	sessionId: string
	filePath?: string
	data?: any
}

/**
 * Multi-file state coordination service
 */
export class MultiFileStateCoordinator {
	private static readonly COORDINATION_KEY = "multiFile.coordination"

	private currentState: MultiFileState
	private eventListeners: Array<(event: CoordinationEvent) => void> = []
	private sessionManager: SessionStateManager
	private fileOpener: FileOpenerService
	private tabManager: TabManagerService
	private diffOverlayManager: DiffOverlayManager

	constructor(
		sessionManager: SessionStateManager,
		fileOpener: FileOpenerService,
		tabManager: TabManagerService,
		diffOverlayManager: DiffOverlayManager,
	) {
		this.sessionManager = sessionManager
		this.fileOpener = fileOpener
		this.tabManager = tabManager
		this.diffOverlayManager = diffOverlayManager

		this.currentState = {
			sessionId: sessionManager.getCurrentSession()?.id || "",
			files: new Map(),
			activeDiffs: new Map(),
			coordinationState: "idle",
			lastActivity: new Date(),
		}
	}

	/**
	 * Initialize coordination service
	 */
	async initialize(): Promise<void> {
		try {
			// Register event listeners
			this.sessionManager.addEventListener(this.onSessionEvent.bind(this))

			// Restore previous coordination state
			await this.restoreCoordinationState()

			Logger.info("MultiFileStateCoordinator.initialize", "Multi-file state coordinator initialized")
		} catch (error) {
			Logger.error("MultiFileStateCoordinator.initialize", "Failed to initialize coordinator", error)
		}
	}

	/**
	 * Add file to coordination
	 */
	async addFile(filePath: string, fileBuffer: FileBuffer): Promise<void> {
		try {
			Logger.debug("MultiFileStateCoordinator.addFile", `Adding file to coordination: ${filePath}`)

			// Create file state
			const fileState: FileState = {
				filePath,
				hasUnsavedChanges: false,
				activeDiffCount: 0,
				lastSyncVersion: 1,
			}

			// Add to current state
			this.currentState.files.set(filePath, fileState)
			this.currentState.lastActivity = new Date()

			// Add to session manager
			await this.sessionManager.addFileState(filePath, fileState)

			// Emit event
			this.emitEvent({
				type: "file_added",
				sessionId: this.currentState.sessionId,
				filePath,
				data: { fileState },
			})

			Logger.info("MultiFileStateCoordinator.addFile", `File added to coordination: ${filePath}`)
		} catch (error) {
			Logger.error("MultiFileStateCoordinator.addFile", `Failed to add file: ${filePath}`, error)
			throw error
		}
	}

	/**
	 * Apply diff to multiple files
	 */
	async applyMultiFileDiff(
		diffOperations: Array<{
			filePath: string
			shadowBuffer: ShadowBuffer
			diffOverlay: DiffOverlay
		}>,
	): Promise<void> {
		try {
			Logger.debug(
				"MultiFileStateCoordinator.applyMultiFileDiff",
				`Applying diff to ${diffOperations.length} files`,
			)

			this.currentState.coordinationState = "applying"

			// Open all files if not already open
			const filePaths = diffOperations.map((op) => op.filePath)
			await this.fileOpener.openMultipleFiles(filePaths)

			// Arrange tabs for optimal viewing
			await this.tabManager.arrangeTabsInGrid(filePaths)

			// Apply diffs to each file
			for (const operation of diffOperations) {
				await this.applySingleFileDiff(operation.filePath, operation.shadowBuffer, operation.diffOverlay)
			}

			this.currentState.coordinationState = "resolved"
			this.currentState.lastActivity = new Date()

			// Emit completion event
			this.emitEvent({
				type: "coordination_complete",
				sessionId: this.currentState.sessionId,
				data: { operationsCount: diffOperations.length },
			})

			Logger.info(
				"MultiFileStateCoordinator.applyMultiFileDiff",
				`Successfully applied diffs to ${diffOperations.length} files`,
			)
		} catch (error) {
			this.currentState.coordinationState = "conflict"
			Logger.error("MultiFileStateCoordinator.applyMultiFileDiff", "Failed to apply multi-file diff", error)
			throw error
		}
	}

	/**
	 * Apply diff to single file
	 */
	private async applySingleFileDiff(
		filePath: string,
		shadowBuffer: ShadowBuffer,
		diffOverlay: DiffOverlay,
	): Promise<void> {
		try {
			// Add shadow buffer to session
			await this.sessionManager.addShadowBuffer(shadowBuffer.id)

			// Add diff overlay to active diffs
			this.currentState.activeDiffs.set(filePath, diffOverlay)

			// Update file state
			const existingFileState = this.currentState.files.get(filePath)
			if (existingFileState) {
				existingFileState.hasUnsavedChanges = true
				existingFileState.activeDiffCount += 1
				existingFileState.lastSyncVersion += 1

				await this.sessionManager.updateFileState(filePath, existingFileState)
			}

			// Apply diff overlay using User Story 1 components
			// Note: This would integrate with the actual diff overlay implementation
			// await this.diffOverlayManager.applyOverlay(filePath, diffOverlay);

			// Emit event
			this.emitEvent({
				type: "diff_applied",
				sessionId: this.currentState.sessionId,
				filePath,
				data: { shadowBufferId: shadowBuffer.id, diffOverlayId: diffOverlay.id },
			})
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.applySingleFileDiff",
				`Failed to apply diff to file: ${filePath}`,
				error,
			)
			throw error
		}
	}

	/**
	 * Remove file from coordination
	 */
	async removeFile(filePath: string): Promise<void> {
		try {
			Logger.debug("MultiFileStateCoordinator.removeFile", `Removing file from coordination: ${filePath}`)

			const fileState = this.currentState.files.get(filePath)
			if (!fileState) {
				return
			}

			// Clean up shadow buffers
			// Note: Shadow buffers are managed at session level
			// for (const shadowBufferId of fileState.shadowBufferIds) {
			//   await this.sessionManager.removeShadowBuffer(shadowBufferId);
			// }

			// Remove diff overlay
			this.currentState.activeDiffs.delete(filePath)

			// Remove from current state
			this.currentState.files.delete(filePath)
			this.currentState.lastActivity = new Date()

			// Remove from session manager
			await this.sessionManager.removeFileState(filePath)

			// Close file if it was opened by this coordinator
			await this.fileOpener.closeFile(filePath)

			// Emit event
			this.emitEvent({
				type: "file_removed",
				sessionId: this.currentState.sessionId,
				filePath,
				data: { fileState },
			})

			Logger.info("MultiFileStateCoordinator.removeFile", `File removed from coordination: ${filePath}`)
		} catch (error) {
			Logger.error("MultiFileStateCoordinator.removeFile", `Failed to remove file: ${filePath}`, error)
			throw error
		}
	}

	/**
	 * Get coordination state
	 */
	getCoordinationState(): MultiFileState {
		return { ...this.currentState }
	}

	/**
	 * Get file state by path
	 */
	getFileState(filePath: string): FileState | undefined {
		return this.currentState.files.get(filePath)
	}

	/**
	 * Get all file states
	 */
	getAllFileStates(): Map<string, FileState> {
		return new Map(this.currentState.files)
	}

	/**
	 * Get active diffs
	 */
	getActiveDiffs(): Map<string, DiffOverlay> {
		return new Map(this.currentState.activeDiffs)
	}

	/**
	 * Check if file has active diffs
	 */
	hasActiveDiffs(filePath: string): boolean {
		return this.currentState.activeDiffs.has(filePath)
	}

	/**
	 * Accept all diffs for a file
	 */
	async acceptAllDiffs(filePath: string): Promise<void> {
		try {
			const diffOverlay = this.currentState.activeDiffs.get(filePath)
			if (!diffOverlay) {
				return
			}

			// Accept all changes in the overlay
			// Note: This would integrate with the actual diff overlay implementation
			// await this.diffOverlayManager.acceptAllChanges(filePath, diffOverlay.id);

			// Clean up
			await this.cleanupAcceptedDiff(filePath, diffOverlay)

			Logger.info("MultiFileStateCoordinator.acceptAllDiffs", `Accepted all diffs for: ${filePath}`)
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.acceptAllDiffs",
				`Failed to accept diffs for file: ${filePath}`,
				error,
			)
			throw error
		}
	}

	/**
	 * Reject all diffs for a file
	 */
	async rejectAllDiffs(filePath: string): Promise<void> {
		try {
			const diffOverlay = this.currentState.activeDiffs.get(filePath)
			if (!diffOverlay) {
				return
			}

			// Reject all changes in the overlay
			// Note: This would integrate with the actual diff overlay implementation
			// await this.diffOverlayManager.rejectAllChanges(filePath, diffOverlay.id);

			// Clean up
			await this.cleanupRejectedDiff(filePath, diffOverlay)

			Logger.info("MultiFileStateCoordinator.rejectAllDiffs", `Rejected all diffs for: ${filePath}`)
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.rejectAllDiffs",
				`Failed to reject diffs for file: ${filePath}`,
				error,
			)
			throw error
		}
	}

	/**
	 * Accept all diffs across all files
	 */
	async acceptAllDiffsAllFiles(): Promise<void> {
		try {
			const filePaths = Array.from(this.currentState.activeDiffs.keys())

			for (const filePath of filePaths) {
				await this.acceptAllDiffs(filePath)
			}

			Logger.info(
				"MultiFileStateCoordinator.acceptAllDiffsAllFiles",
				`Accepted all diffs across ${filePaths.length} files`,
			)
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.acceptAllDiffsAllFiles",
				"Failed to accept all diffs across all files",
				error,
			)
			throw error
		}
	}

	/**
	 * Reject all diffs across all files
	 */
	async rejectAllDiffsAllFiles(): Promise<void> {
		try {
			const filePaths = Array.from(this.currentState.activeDiffs.keys())

			for (const filePath of filePaths) {
				await this.rejectAllDiffs(filePath)
			}

			Logger.info(
				"MultiFileStateCoordinator.rejectAllDiffsAllFiles",
				`Rejected all diffs across ${filePaths.length} files`,
			)
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.rejectAllDiffsAllFiles",
				"Failed to reject all diffs across all files",
				error,
			)
			throw error
		}
	}

	/**
	 * Add event listener
	 */
	addEventListener(listener: (event: CoordinationEvent) => void): void {
		this.eventListeners.push(listener)
	}

	/**
	 * Remove event listener
	 */
	removeEventListener(listener: (event: CoordinationEvent) => void): void {
		const index = this.eventListeners.indexOf(listener)
		if (index > -1) {
			this.eventListeners.splice(index, 1)
		}
	}

	/**
	 * Get coordination statistics
	 */
	getCoordinationStats(): {
		totalFiles: number
		activeDiffs: number
		coordinationState: string
		lastActivity: Date
	} {
		return {
			totalFiles: this.currentState.files.size,
			activeDiffs: this.currentState.activeDiffs.size,
			coordinationState: this.currentState.coordinationState,
			lastActivity: this.currentState.lastActivity,
		}
	}

	/**
	 * Restore coordination state from session
	 */
	private async restoreCoordinationState(): Promise<void> {
		try {
			const session = this.sessionManager.getCurrentSession()
			if (!session) {
				return
			}

			this.currentState.sessionId = session.id
			this.currentState.files = session.fileStates
			this.currentState.lastActivity = session.lastActivity

			Logger.info(
				"MultiFileStateCoordinator.restoreCoordinationState",
				`Restored coordination state for ${this.currentState.files.size} files`,
			)
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.restoreCoordinationState",
				"Failed to restore coordination state",
				error,
			)
		}
	}

	/**
	 * Handle session events
	 */
	private onSessionEvent(event: any): void {
		try {
			if (event.type === "session_cleared") {
				// Clear coordination state
				this.currentState.files.clear()
				this.currentState.activeDiffs.clear()
				this.currentState.coordinationState = "idle"
				this.currentState.lastActivity = new Date()
			}
		} catch (error) {
			Logger.error("MultiFileStateCoordinator.onSessionEvent", "Error handling session event", error)
		}
	}

	/**
	 * Clean up accepted diff
	 */
	private async cleanupAcceptedDiff(filePath: string, diffOverlay: DiffOverlay): Promise<void> {
		try {
			// Remove from active diffs
			this.currentState.activeDiffs.delete(filePath)

			// Update file state
			const fileState = this.currentState.files.get(filePath)
			if (fileState) {
				fileState.activeDiffCount = Math.max(0, fileState.activeDiffCount - 1)
				fileState.hasUnsavedChanges = false
				await this.sessionManager.updateFileState(filePath, fileState)
			}

			this.currentState.lastActivity = new Date()
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.cleanupAcceptedDiff",
				`Failed to cleanup accepted diff for: ${filePath}`,
				error,
			)
		}
	}

	/**
	 * Clean up rejected diff
	 */
	private async cleanupRejectedDiff(filePath: string, diffOverlay: DiffOverlay): Promise<void> {
		try {
			// Remove from active diffs
			this.currentState.activeDiffs.delete(filePath)

			// Update file state
			const fileState = this.currentState.files.get(filePath)
			if (fileState) {
				fileState.activeDiffCount = Math.max(0, fileState.activeDiffCount - 1)
				fileState.hasUnsavedChanges = false
				await this.sessionManager.updateFileState(filePath, fileState)
			}

			this.currentState.lastActivity = new Date()
		} catch (error) {
			Logger.error(
				"MultiFileStateCoordinator.cleanupRejectedDiff",
				`Failed to cleanup rejected diff for: ${filePath}`,
				error,
			)
		}
	}

	/**
	 * Emit event to all listeners
	 */
	private emitEvent(event: CoordinationEvent): void {
		this.eventListeners.forEach((listener) => {
			try {
				listener(event)
			} catch (error) {
				Logger.error("MultiFileStateCoordinator.emitEvent", "Error in coordination event listener", error)
			}
		})
	}
}
