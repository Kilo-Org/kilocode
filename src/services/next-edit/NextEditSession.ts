/**
 * NextEditSession Service
 *
 * Orchestrates the Next Edit workflow, managing session lifecycle
 * and coordinating between storage, analysis, sequencing, and execution services.
 *
 * @module NextEditSession
 */

import type * as vscode from "vscode"
import type { EditSession, EditSuggestion, EditContext, EditAction, SessionStatus, EditStatus } from "./types"
import { SessionStatus as SessionStatusEnum, EditStatus as EditStatusEnum, ActionType } from "./types"
import type { ISessionStorage } from "./SessionStorage"
import type { IEditAnalyzer } from "./EditAnalyzer"
import type { IEditSequencer } from "./EditSequencer"
import type { IEditExecutor } from "./EditExecutor"
import { createSessionNotFoundError, createInvalidSessionIdError } from "./errors"
import { generateUUID } from "./utils"

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message with timestamp
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
	const timestamp = new Date().toISOString()
	const logMessage = `[${timestamp}] [NextEditSession] [${level.toUpperCase()}] ${message}`

	if (level === "error") {
		console.error(logMessage, data)
	} else if (level === "warn") {
		console.warn(logMessage, data)
	} else {
		console.log(logMessage, data)
	}
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Progress information for a session
 */
export interface SessionProgress {
	/** Current edit index */
	current: number
	/** Total number of edits */
	total: number
	/** Number of completed edits */
	completed: number
	/** Number of skipped edits */
	skipped: number
	/** Number of remaining edits */
	remaining: number
	/** Percentage complete (0-100) */
	percentage: number
}

/**
 * Summary of a completed or paused session
 */
export interface SessionSummary {
	/** Session ID */
	sessionId: string
	/** User's edit goal */
	goal: string
	/** Current session status */
	status: string
	/** Total number of edits */
	totalEdits: number
	/** Number of completed edits */
	completedEdits: number
	/** Number of skipped edits */
	skippedEdits: number
	/** Number of modified edits */
	modifiedEdits: number
	/** Number of pending edits */
	pendingEdits: number
	/** Number of errors encountered */
	errors: number
	/** Files that were changed */
	filesChanged: string[]
	/** Estimated time remaining (seconds) */
	estimatedTimeRemaining: number
}

/**
 * Interface for NextEditSession service
 */
export interface INextEditSession {
	/**
	 * Starts a new Next Edit session
	 *
	 * @param workspaceUri - VSCode workspace URI
	 * @param goal - User's edit goal description
	 * @param options - Optional analysis configuration
	 * @returns Promise with created session
	 */
	start(
		workspaceUri: string,
		goal: string,
		options?: {
			includePatterns?: string[]
			excludePatterns?: string[]
			maxFiles?: number
		},
	): Promise<EditSession>

	/**
	 * Gets the next edit in sequence
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with next edit and context
	 */
	getNextEdit(sessionId: string): Promise<{
		edit: EditSuggestion
		context: EditContext
	}>

	/**
	 * Applies an edit
	 *
	 * @param sessionId - The session ID
	 * @param editId - The edit ID to apply
	 * @param modification - Optional user modification
	 * @returns Promise with action result
	 */
	applyEdit(sessionId: string, editId: string, modification?: string): Promise<EditAction>

	/**
	 * Skips an edit
	 *
	 * @param sessionId - The session ID
	 * @param editId - The edit ID to skip
	 * @param reason - Optional skip reason
	 * @returns Promise with action result
	 */
	skipEdit(sessionId: string, editId: string, reason?: string): Promise<EditAction>

	/**
	 * Gets session progress
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with progress information
	 */
	getProgress(sessionId: string): Promise<SessionProgress>

	/**
	 * Pauses a session
	 *
	 * @param sessionId - The session ID
	 * @returns Promise that resolves when paused
	 */
	pause(sessionId: string): Promise<void>

	/**
	 * Resumes a paused session
	 *
	 * @param sessionId - The session ID
	 * @returns Promise that resolves when resumed
	 */
	resume(sessionId: string): Promise<void>

	/**
	 * Cancels a session
	 *
	 * @param sessionId - The session ID
	 * @param reason - Optional cancellation reason
	 * @returns Promise that resolves when cancelled
	 */
	cancel(sessionId: string, reason?: string): Promise<void>

	/**
	 * Completes a session
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with session summary
	 */
	complete(sessionId: string): Promise<SessionSummary>

	/**
	 * Gets session summary
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with session summary
	 */
	getSummary(sessionId: string): Promise<SessionSummary>

	/**
	 * Undoes the last edit in a session
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with undone action
	 */
	undoLastEdit(sessionId: string): Promise<EditAction | null>

	/**
	 * Redoes the last undone edit in a session
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with redone action
	 */
	redoLastEdit(sessionId: string): Promise<EditAction | null>

	/**
	 * Gets a session by ID
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with session, or null if not found
	 */
	getSession(sessionId: string): Promise<EditSession | null>

	/**
	 * Lists all sessions
	 *
	 * @returns Promise with array of sessions
	 */
	listSessions(): Promise<EditSession[]>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * NextEditSession implementation
 */
export class NextEditSession implements INextEditSession {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly storage: ISessionStorage,
		private readonly analyzer: IEditAnalyzer,
		private readonly sequencer: IEditSequencer,
		private readonly executor: IEditExecutor,
	) {}

	async start(
		workspaceUri: string,
		goal: string,
		options?: {
			includePatterns?: string[]
			excludePatterns?: string[]
			maxFiles?: number
		},
	): Promise<EditSession> {
		const startTime = Date.now()

		try {
			if (!workspaceUri) {
				log("error", "Cannot start session: workspace URI is required")
				throw new Error("Workspace URI is required. Please provide a valid workspace path.")
			}
			if (!goal || goal.trim().length === 0) {
				log("error", "Cannot start session: goal is required")
				throw new Error("Goal is required. Please describe what you want to accomplish.")
			}

			log("info", "Starting new Next Edit session", { workspaceUri, goal, options })

			// Analyze codebase
			const analysisResult = await this.analyzer.analyzeCodebase(workspaceUri, goal, {
				includePatterns: options?.includePatterns,
				excludePatterns: options?.excludePatterns,
				maxFiles: options?.maxFiles,
			})

			// Generate edit suggestions
			const edits = analysisResult.edits
			log("info", `Analysis found ${edits.length} edit suggestions`)

			// Sequence edits
			const sequencingResult = await this.sequencer.sequenceEdits(edits)

			// Create session
			const session = this.createSession(
				workspaceUri,
				goal,
				edits,
				analysisResult.totalFiles,
				analysisResult.estimatedTime,
			)

			// Save session
			await this.storage.saveSession(session)

			// Set as active session
			await this.storage.setActiveSessionId(session.id)

			const duration = Date.now() - startTime
			log("info", `Session started successfully: ${session.id}`, {
				editCount: edits.length,
				estimatedTime: analysisResult.estimatedTime,
				duration: `${duration}ms`,
			})

			return session
		} catch (error) {
			const duration = Date.now() - startTime
			log("error", `Failed to start session after ${duration}ms`, error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to start session: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async getNextEdit(sessionId: string): Promise<{
		edit: EditSuggestion
		context: EditContext
	}> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}

			const session = await this.getSession(sessionId)
			if (!session) {
				throw createSessionNotFoundError(sessionId)
			}

			// Find next pending edit
			const nextEdit = session.edits.find((edit) => edit.status === EditStatusEnum.PENDING)
			if (!nextEdit) {
				throw new Error("No more edits to process. All edits have been completed or skipped.")
			}

			// Generate context (need to read file content first)
			const context = await this.analyzer.generateContext(nextEdit, nextEdit.originalContent)

			return { edit: nextEdit, context }
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to get next edit: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async applyEdit(sessionId: string, editId: string, modification?: string): Promise<EditAction> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}
			if (!editId) {
				throw new Error("Edit ID is required")
			}

			const session = await this.getSession(sessionId)
			if (!session) {
				throw createSessionNotFoundError(sessionId)
			}

			const edit = session.edits.find((e) => e.id === editId)
			if (!edit) {
				throw new Error(`Edit ${editId} not found in session`)
			}

			// Apply edit using executor
			const result = await this.executor.applyEdit(edit, modification)

			if (!result.success) {
				throw new Error(result.error || "Failed to apply edit")
			}

			// Update session
			edit.status = EditStatusEnum.ACCEPTED
			if (modification) {
				edit.userModification = modification
			}
			session.completedEdits.push(editId)
			session.currentEditIndex++
			session.undoStack.push(result.action)
			session.updatedAt = new Date()

			await this.storage.saveSession(session)

			return result.action
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to apply edit: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async skipEdit(sessionId: string, editId: string, reason?: string): Promise<EditAction> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}
			if (!editId) {
				throw new Error("Edit ID is required")
			}

			const session = await this.getSession(sessionId)
			if (!session) {
				throw createSessionNotFoundError(sessionId)
			}

			const edit = session.edits.find((e) => e.id === editId)
			if (!edit) {
				throw new Error(`Edit ${editId} not found in session`)
			}

			// Update edit status
			edit.status = EditStatusEnum.SKIPPED
			session.skippedEdits.push(editId)
			session.currentEditIndex++
			session.updatedAt = new Date()

			// Create action record
			const action: EditAction = {
				id: generateUUID(),
				editId,
				sessionId,
				action: ActionType.SKIP,
				timestamp: new Date(),
				originalContent: edit.originalContent,
				duration: 0,
				userNotes: reason,
			}

			await this.storage.saveSession(session)

			return action
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to skip edit: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async getProgress(sessionId: string): Promise<SessionProgress> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}

			const session = await this.getSession(sessionId)
			if (!session) {
				throw createSessionNotFoundError(sessionId)
			}

			return this.calculateProgress(session)
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to get progress: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async pause(sessionId: string): Promise<void> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}

			await this.updateSessionStatus(sessionId, SessionStatusEnum.PAUSED)
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to pause session: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async resume(sessionId: string): Promise<void> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		await this.updateSessionStatus(sessionId, SessionStatusEnum.ACTIVE)
	}

	async cancel(sessionId: string, reason?: string): Promise<void> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		await this.updateSessionStatus(sessionId, SessionStatusEnum.CANCELLED)
	}

	async complete(sessionId: string): Promise<SessionSummary> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		const session = await this.getSession(sessionId)
		if (!session) {
			throw createSessionNotFoundError(sessionId)
		}

		await this.updateSessionStatus(sessionId, SessionStatusEnum.COMPLETED)

		return this.generateSummary(session)
	}

	async getSummary(sessionId: string): Promise<SessionSummary> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		const session = await this.getSession(sessionId)
		if (!session) {
			throw createSessionNotFoundError(sessionId)
		}

		return this.generateSummary(session)
	}

	async undoLastEdit(sessionId: string): Promise<EditAction | null> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		const session = await this.getSession(sessionId)
		if (!session) {
			throw createSessionNotFoundError(sessionId)
		}

		const action = await this.executor.undoLastEdit(sessionId)
		if (!action) {
			return null
		}

		// Update session
		const editIndex = session.completedEdits.indexOf(action.editId)
		if (editIndex !== -1) {
			session.completedEdits.splice(editIndex, 1)
		}
		session.currentEditIndex--
		session.redoStack.push(action)
		session.updatedAt = new Date()

		await this.storage.saveSession(session)

		return action
	}

	async redoLastEdit(sessionId: string): Promise<EditAction | null> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		const session = await this.getSession(sessionId)
		if (!session) {
			throw createSessionNotFoundError(sessionId)
		}

		const action = await this.executor.redoLastEdit(sessionId)
		if (!action) {
			return null
		}

		// Update session
		session.completedEdits.push(action.editId)
		session.currentEditIndex++
		session.undoStack.push(action)
		session.updatedAt = new Date()

		await this.storage.saveSession(session)

		return action
	}

	async getSession(sessionId: string): Promise<EditSession | null> {
		if (!sessionId) {
			throw createInvalidSessionIdError(sessionId)
		}

		return await this.storage.loadSession(sessionId)
	}

	async listSessions(): Promise<EditSession[]> {
		const sessionIds = await this.storage.listSessions()
		const sessions: EditSession[] = []

		for (const sessionId of sessionIds) {
			const session = await this.storage.loadSession(sessionId)
			if (session) {
				sessions.push(session)
			}
		}

		return sessions
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Creates a new session object
	 */
	private createSession(
		workspaceUri: string,
		goal: string,
		edits: EditSuggestion[],
		totalFiles?: number,
		estimatedTime?: number,
	): EditSession {
		const now = new Date()
		return {
			id: generateUUID(),
			workspaceUri,
			createdAt: now,
			updatedAt: now,
			status: SessionStatusEnum.ACTIVE,
			goal,
			edits,
			currentEditIndex: 0,
			completedEdits: [],
			skippedEdits: [],
			undoStack: [],
			redoStack: [],
			totalFiles: totalFiles ?? new Set(edits.map((e) => e.filePath)).size,
			estimatedTime: estimatedTime ?? edits.length * 30, // 30 seconds per edit
		}
	}

	/**
	 * Updates session status
	 */
	private async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
		const session = await this.getSession(sessionId)
		if (!session) {
			throw createSessionNotFoundError(sessionId)
		}

		session.status = status
		session.updatedAt = new Date()

		await this.storage.saveSession(session)
	}

	/**
	 * Calculates progress percentage
	 */
	private calculateProgress(session: EditSession): SessionProgress {
		const total = session.edits.length
		const completed = session.completedEdits.length
		const skipped = session.skippedEdits.length
		const remaining = total - completed - skipped
		const percentage = total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0

		return {
			current: session.currentEditIndex,
			total,
			completed,
			skipped,
			remaining,
			percentage,
		}
	}

	/**
	 * Generates session summary
	 */
	private generateSummary(session: EditSession): SessionSummary {
		const modifiedEdits = session.edits.filter(
			(e) => e.status === EditStatusEnum.ACCEPTED && e.userModification,
		).length
		const pendingEdits = session.edits.filter((e) => e.status === EditStatusEnum.PENDING).length
		const errorEdits = session.edits.filter((e) => e.status === EditStatusEnum.ERROR).length
		const filesChanged = new Set(
			session.edits.filter((e) => e.status === EditStatusEnum.ACCEPTED).map((e) => e.filePath),
		)
		const remainingEdits = session.edits.length - session.completedEdits.length - session.skippedEdits.length
		const estimatedTimeRemaining = remainingEdits * 30 // 30 seconds per edit

		return {
			sessionId: session.id,
			goal: session.goal,
			status: session.status,
			totalEdits: session.edits.length,
			completedEdits: session.completedEdits.length,
			skippedEdits: session.skippedEdits.length,
			modifiedEdits,
			pendingEdits,
			errors: errorEdits,
			filesChanged: Array.from(filesChanged),
			estimatedTimeRemaining,
		}
	}
}
