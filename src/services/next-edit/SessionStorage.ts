/**
 * SessionStorage Service
 *
 * Handles persistence and retrieval of EditSession data using VSCode's workspaceState API.
 * This service is responsible for saving, loading, and managing session state.
 *
 * @module SessionStorage
 */

import type * as vscode from "vscode"
import type { EditSession, NextEditWorkspaceState } from "./types"
import { createSessionNotFoundError, createInvalidSessionIdError } from "./errors"

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message with timestamp
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
	const timestamp = new Date().toISOString()
	const logMessage = `[${timestamp}] [SessionStorage] [${level.toUpperCase()}] ${message}`

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
 * Interface for SessionStorage service
 */
export interface ISessionStorage {
	/**
	 * Saves a session to workspace storage
	 *
	 * @param session - The session to save
	 * @returns Promise that resolves when save is complete
	 */
	saveSession(session: EditSession): Promise<void>

	/**
	 * Loads a session by ID
	 *
	 * @param sessionId - The session ID to load
	 * @returns Promise with the loaded session, or null if not found
	 */
	loadSession(sessionId: string): Promise<EditSession | null>

	/**
	 * Deletes a session from storage
	 *
	 * @param sessionId - The session ID to delete
	 * @returns Promise that resolves when deletion is complete
	 */
	deleteSession(sessionId: string): Promise<void>

	/**
	 * Gets the ID of the currently active session
	 *
	 * @returns Promise with the active session ID, or null if no active session
	 */
	getActiveSessionId(): Promise<string | null>

	/**
	 * Sets the active session ID
	 *
	 * @param sessionId - The session ID to set as active
	 * @returns Promise that resolves when update is complete
	 */
	setActiveSessionId(sessionId: string): Promise<void>

	/**
	 * Clears the active session ID
	 *
	 * @returns Promise that resolves when clear is complete
	 */
	clearActiveSessionId(): Promise<void>

	/**
	 * Lists all session IDs in storage
	 *
	 * @returns Promise with array of session IDs
	 */
	listSessions(): Promise<string[]>

	/**
	 * Gets the last session ID
	 *
	 * @returns Promise with the last session ID, or null if no sessions exist
	 */
	getLastSessionId(): Promise<string | null>

	/**
	 * Sets the last session ID
	 *
	 * @param sessionId - The session ID to set as last
	 * @returns Promise that resolves when update is complete
	 */
	setLastSessionId(sessionId: string): Promise<void>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * SessionStorage implementation using VSCode workspaceState
 */
export class SessionStorage implements ISessionStorage {
	private readonly stateKey = "nextEditWorkspaceState"

	constructor(private readonly context: vscode.ExtensionContext) {}

	async saveSession(session: EditSession): Promise<void> {
		try {
			if (!session || !session.id) {
				log("error", "Cannot save session: invalid session or session ID", { session })
				throw createInvalidSessionIdError(session?.id || "")
			}

			log("info", `Saving session: ${session.id}`, {
				goal: session.goal,
				status: session.status,
				editCount: session.edits.length,
			})

			const state = this.getWorkspaceState()
			state.sessions[session.id] = session
			this.updateWorkspaceState(state)

			log("info", `Session saved successfully: ${session.id}`)
		} catch (error) {
			log("error", `Failed to save session: ${session?.id}`, error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to save session: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async loadSession(sessionId: string): Promise<EditSession | null> {
		try {
			if (!sessionId) {
				log("error", "Cannot load session: invalid session ID")
				throw createInvalidSessionIdError(sessionId)
			}

			log("info", `Loading session: ${sessionId}`)

			const state = this.getWorkspaceState()
			const session = state.sessions[sessionId] || null

			if (session) {
				log("info", `Session loaded successfully: ${sessionId}`, {
					goal: session.goal,
					status: session.status,
				})
			} else {
				log("warn", `Session not found: ${sessionId}`)
			}

			return session
		} catch (error) {
			log("error", `Failed to load session: ${sessionId}`, error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to load session: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}

			const state = this.getWorkspaceState()
			if (!state.sessions[sessionId]) {
				throw createSessionNotFoundError(sessionId)
			}

			delete state.sessions[sessionId]
			this.updateWorkspaceState(state)
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to delete session: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async getActiveSessionId(): Promise<string | null> {
		try {
			const state = this.getWorkspaceState()
			return state.activeSessionId || null
		} catch (error) {
			throw new Error(
				`Failed to get active session ID: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	async setActiveSessionId(sessionId: string): Promise<void> {
		try {
			if (!sessionId) {
				throw createInvalidSessionIdError(sessionId)
			}

			const state = this.getWorkspaceState()
			state.activeSessionId = sessionId
			this.updateWorkspaceState(state)
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to set active session ID: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	async clearActiveSessionId(): Promise<void> {
		const state = this.getWorkspaceState()
		state.activeSessionId = undefined
		this.updateWorkspaceState(state)
	}

	async listSessions(): Promise<string[]> {
		const state = this.getWorkspaceState()
		return Object.keys(state.sessions)
	}

	async getLastSessionId(): Promise<string | null> {
		const state = this.getWorkspaceState()
		return state.lastSessionId || null
	}

	async setLastSessionId(sessionId: string): Promise<void> {
		const state = this.getWorkspaceState()
		state.lastSessionId = sessionId
		this.updateWorkspaceState(state)
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Gets the full workspace state object
	 */
	private getWorkspaceState(): NextEditWorkspaceState {
		return (
			this.context.workspaceState.get<NextEditWorkspaceState>(this.stateKey) || {
				sessions: {},
			}
		)
	}

	/**
	 * Updates the workspace state object
	 */
	private updateWorkspaceState(state: NextEditWorkspaceState): void {
		this.context.workspaceState.update(this.stateKey, state)
	}
}
