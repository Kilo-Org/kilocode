/**
 * SessionStateManager - Centralized state management for CLI sessions.
 *
 * This class manages all session-related state including:
 * - Active session tracking
 * - Session verification cache
 * - Git state tracking (URLs and hashes)
 * - Session titles
 * - Timestamp tracking (high-water mark)
 * - Mode/Model tracking
 * - Task-to-session ID mapping
 *
 * Extracted from SessionManager as part of the refactoring effort to improve
 * maintainability and testability through separation of concerns.
 */
export class SessionStateManager {
	// Active session state
	private lastActiveSessionId: string | null = null

	// Workspace directory
	private workspaceDir: string | null = null

	// Session verification cache - tracks which sessions have been verified to exist
	private verifiedSessions: Set<string> = new Set()

	// Git state tracking per task
	private taskGitUrls: Record<string, string> = {}
	private taskGitHashes: Record<string, string> = {}

	// Session titles - prevents duplicate title generation
	private sessionTitles: Record<string, string> = {}

	// Timestamp tracking - high-water mark for session updates
	private sessionUpdatedAt: Record<string, string> = {}

	// Mode/Model tracking per session
	private lastSessionMode: Record<string, string> = {}
	private lastSessionModel: Record<string, string> = {}

	// Token validity cache
	private tokenValid: Record<string, boolean | undefined> = {}

	// In-memory task session cache - fallback when workspace isn't present
	// and persistence manager can't persist data
	private taskSession: Record<string, string> = {}

	/**
	 * Gets the current active session ID.
	 */
	getActiveSessionId(): string | null {
		return this.lastActiveSessionId
	}

	/**
	 * Sets the active session ID.
	 */
	setActiveSessionId(sessionId: string | null): void {
		this.lastActiveSessionId = sessionId
	}

	/**
	 * Checks if a session has been verified to exist.
	 */
	isSessionVerified(sessionId: string): boolean {
		return this.verifiedSessions.has(sessionId)
	}

	/**
	 * Marks a session as verified (confirmed to exist).
	 */
	markSessionVerified(sessionId: string): void {
		this.verifiedSessions.add(sessionId)
	}

	/**
	 * Clears the verified status for a session.
	 */
	clearSessionVerified(sessionId: string): void {
		this.verifiedSessions.delete(sessionId)
	}

	/**
	 * Gets the git URL for a task.
	 */
	getGitUrl(taskId: string): string | undefined {
		return this.taskGitUrls[taskId]
	}

	/**
	 * Sets the git URL for a task.
	 */
	setGitUrl(taskId: string, url: string): void {
		this.taskGitUrls[taskId] = url
	}

	/**
	 * Gets the git state hash for a task.
	 */
	getGitHash(taskId: string): string | undefined {
		return this.taskGitHashes[taskId]
	}

	/**
	 * Sets the git state hash for a task.
	 */
	setGitHash(taskId: string, hash: string): void {
		this.taskGitHashes[taskId] = hash
	}

	/**
	 * Checks if a session has a title set.
	 */
	hasTitle(sessionId: string): boolean {
		return sessionId in this.sessionTitles
	}

	/**
	 * Gets the title for a session.
	 */
	getTitle(sessionId: string): string | undefined {
		return this.sessionTitles[sessionId]
	}

	/**
	 * Sets the title for a session.
	 */
	setTitle(sessionId: string, title: string): void {
		this.sessionTitles[sessionId] = title
	}

	/**
	 * Gets the updated_at timestamp for a session.
	 */
	getUpdatedAt(sessionId: string): string | undefined {
		return this.sessionUpdatedAt[sessionId]
	}

	/**
	 * Updates the session timestamp using high-water mark logic.
	 * Only updates if the new timestamp is greater than the current one,
	 * preventing race conditions when multiple concurrent uploads complete.
	 */
	updateTimestamp(sessionId: string, updatedAt: string): void {
		const currentUpdatedAt = this.sessionUpdatedAt[sessionId]
		if (!currentUpdatedAt || updatedAt > currentUpdatedAt) {
			this.sessionUpdatedAt[sessionId] = updatedAt
		}
	}

	/**
	 * Gets the mode for a session.
	 */
	getMode(sessionId: string): string | undefined {
		return this.lastSessionMode[sessionId]
	}

	/**
	 * Sets the mode for a session.
	 */
	setMode(sessionId: string, mode: string): void {
		this.lastSessionMode[sessionId] = mode
	}

	/**
	 * Gets the model for a session.
	 */
	getModel(sessionId: string): string | undefined {
		return this.lastSessionModel[sessionId]
	}

	/**
	 * Sets the model for a session.
	 */
	setModel(sessionId: string, model: string): void {
		this.lastSessionModel[sessionId] = model
	}

	/**
	 * Gets the token validity status.
	 */
	getTokenValidity(token: string): boolean | undefined {
		return this.tokenValid[token]
	}

	/**
	 * Sets the token validity status.
	 */
	setTokenValidity(token: string, valid: boolean): void {
		this.tokenValid[token] = valid
	}

	/**
	 * Clears the token validity cache for a specific token.
	 */
	clearTokenValidity(token: string): void {
		this.tokenValid[token] = undefined
	}

	/**
	 * Gets the session ID for a task from in-memory storage.
	 * Used as fallback when workspace isn't present and persistence manager can't persist data.
	 * @param taskId - The task ID
	 * @returns The session ID if found, undefined otherwise.
	 */
	getSessionForTask(taskId: string): string | undefined {
		return this.taskSession[taskId]
	}

	/**
	 * Sets the session ID for a task in in-memory storage.
	 * Used as fallback when workspace isn't present and persistence manager can't persist data.
	 * @param taskId - The task ID
	 * @param sessionId - The session ID to set.
	 */
	setSessionForTask(taskId: string, sessionId: string): void {
		this.taskSession[taskId] = sessionId
	}

	/**
	 * Gets the workspace directory.
	 */
	getWorkspaceDir(): string | null {
		return this.workspaceDir
	}

	/**
	 * Sets the workspace directory.
	 */
	setWorkspaceDir(dir: string): void {
		this.workspaceDir = dir
	}

	/**
	 * Resets all state. Useful for testing.
	 */
	reset(): void {
		this.lastActiveSessionId = null
		this.workspaceDir = null
		this.verifiedSessions.clear()
		this.taskGitUrls = {}
		this.taskGitHashes = {}
		this.sessionTitles = {}
		this.sessionUpdatedAt = {}
		this.lastSessionMode = {}
		this.lastSessionModel = {}
		this.tokenValid = {}
		this.taskSession = {}
	}
}
