import { AgentSession, AgentStatus, AgentManagerState, PendingSession } from "./types"

const MAX_SESSIONS = 10
const MAX_LOGS = 100

export class AgentRegistry {
	private sessions: Map<string, AgentSession> = new Map()
	private _selectedId: string | null = null
	private _pendingSession: PendingSession | null = null

	public get selectedId(): string | null {
		return this._selectedId
	}

	public set selectedId(sessionId: string | null) {
		this._selectedId = sessionId && this.sessions.has(sessionId) ? sessionId : null
	}

	public get pendingSession(): PendingSession | null {
		return this._pendingSession
	}

	/**
	 * Set a pending session while waiting for CLI's session_created event
	 */
	public setPendingSession(prompt: string, options?: { gitUrl?: string }): PendingSession {
		const label = this.truncatePrompt(prompt)
		this._pendingSession = {
			prompt,
			label,
			startTime: Date.now(),
			gitUrl: options?.gitUrl,
		}
		return this._pendingSession
	}

	/**
	 * Clear the pending session (called after session is created or on error)
	 */
	public clearPendingSession(): void {
		this._pendingSession = null
	}

	/**
	 * Create a session with the CLI-provided sessionId
	 */
	public createSession(
		sessionId: string,
		prompt: string,
		startTime?: number,
		options?: { gitUrl?: string },
	): AgentSession {
		const label = this.truncatePrompt(prompt)

		const session: AgentSession = {
			sessionId,
			label,
			prompt,
			status: "running",
			startTime: startTime ?? Date.now(),
			logs: ["Starting agent..."],
			source: "local",
			gitUrl: options?.gitUrl,
		}

		this.sessions.set(sessionId, session)
		this.selectedId = sessionId
		this.pruneOldSessions()

		return session
	}

	public hasActiveProcess(sessionId: string): boolean {
		const session = this.sessions.get(sessionId)
		return session?.status === "running" && session?.pid !== undefined
	}

	public updateSessionStatus(
		sessionId: string,
		status: AgentStatus,
		exitCode?: number,
		error?: string,
	): AgentSession | undefined {
		const session = this.sessions.get(sessionId)
		if (!session) return undefined

		session.status = status
		if (status === "done" || status === "error") {
			session.endTime = Date.now()
		}
		if (exitCode !== undefined) {
			session.exitCode = exitCode
		}
		if (error) {
			session.error = error
		}

		return session
	}

	public getSession(sessionId: string): AgentSession | undefined {
		return this.sessions.get(sessionId)
	}

	public getSessions(): AgentSession[] {
		return Array.from(this.sessions.values()).sort((a, b) => b.startTime - a.startTime)
	}

	public getSessionsForGitUrl(gitUrl: string | undefined): AgentSession[] {
		const allSessions = this.getSessions()

		if (!gitUrl) {
			return allSessions.filter((session) => !session.gitUrl)
		}

		return allSessions.filter((session) => session.gitUrl === gitUrl)
	}

	public appendLog(sessionId: string, line: string): void {
		const session = this.sessions.get(sessionId)
		if (!session) return

		session.logs.push(line)
		if (session.logs.length > MAX_LOGS) {
			session.logs = session.logs.slice(-MAX_LOGS)
		}
	}

	public setSessionPid(sessionId: string, pid: number): void {
		const session = this.sessions.get(sessionId)
		if (session) {
			session.pid = pid
		}
	}

	public getState(): AgentManagerState {
		return {
			sessions: this.getSessions(),
			selectedId: this.selectedId,
		}
	}

	public getStateForGitUrl(gitUrl: string | undefined): AgentManagerState {
		const sessions = this.getSessionsForGitUrl(gitUrl)
		const sessionIds = new Set(sessions.map((s) => s.sessionId))

		return {
			sessions,
			selectedId: this.selectedId && sessionIds.has(this.selectedId) ? this.selectedId : null,
		}
	}

	public hasPendingOrRunningSessions(): boolean {
		return this._pendingSession !== null || this.getRunningSessionCount() > 0
	}

	public hasRunningSessions(): boolean {
		return this.getRunningSessionCount() > 0
	}

	public getRunningSessionCount(): number {
		let count = 0
		for (const session of this.sessions.values()) {
			if (session.status === "running") {
				count++
			}
		}
		return count
	}

	private pruneOldSessions(): void {
		const sessions = this.getSessions()
		const overflow = sessions.length - MAX_SESSIONS
		if (overflow <= 0) return

		const nonRunning = sessions.filter((s) => s.status !== "running")
		if (nonRunning.length === 0) return

		const toRemove = nonRunning.slice(-Math.min(overflow, nonRunning.length))

		for (const session of toRemove) {
			this.sessions.delete(session.sessionId)
		}
	}

	private truncatePrompt(prompt: string, maxLength = 40): string {
		const cleaned = prompt.replace(/\s+/g, " ").trim()
		if (cleaned.length <= maxLength) {
			return cleaned
		}
		return cleaned.substring(0, maxLength - 3) + "..."
	}
}
