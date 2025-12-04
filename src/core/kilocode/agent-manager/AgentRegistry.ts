import { randomUUID } from "node:crypto"
import { AgentSession, AgentStatus, AgentManagerState } from "./types"

const MAX_SESSIONS = 10
const MAX_LOGS = 100

/**
 * In-memory registry for agent sessions.
 * Manages session lifecycle and provides state for the webview.
 */
export class AgentRegistry {
	private sessions: Map<string, AgentSession> = new Map()
	private _selectedId: string | null = null

	public get selectedId(): string | null {
		return this._selectedId
	}

	public set selectedId(id: string | null) {
		this._selectedId = id && this.sessions.has(id) ? id : null
	}

	public createSession(prompt: string): AgentSession {
		const id = this.generateId()
		const label = this.truncatePrompt(prompt)

		const session: AgentSession = {
			id,
			label,
			prompt,
			status: "running",
			startTime: Date.now(),
			logs: ["Starting agent..."],
		}

		this.sessions.set(id, session)
		this.selectedId = id
		this.pruneOldSessions()

		return session
	}

	public updateSessionStatus(
		id: string,
		status: AgentStatus,
		exitCode?: number,
		error?: string,
	): AgentSession | undefined {
		const session = this.sessions.get(id)
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

	public removeSession(id: string): boolean {
		const deleted = this.sessions.delete(id)
		// If we removed the selected session, select the first remaining one
		if (deleted && this.selectedId === id) {
			const sessions = this.getSessions()
			this.selectedId = sessions.length > 0 ? sessions[0].id : null
		}
		return deleted
	}

	public getSession(id: string): AgentSession | undefined {
		return this.sessions.get(id)
	}

	public getSessions(): AgentSession[] {
		return Array.from(this.sessions.values()).sort((a, b) => b.startTime - a.startTime)
	}

	public appendLog(id: string, line: string): void {
		const session = this.sessions.get(id)
		if (!session) return

		session.logs.push(line)
		if (session.logs.length > MAX_LOGS) {
			session.logs = session.logs.slice(-MAX_LOGS)
		}
	}

	public setSessionPid(id: string, pid: number): void {
		const session = this.sessions.get(id)
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

	/**
	 * Remove oldest sessions if exceeding max, preferring non-running sessions.
	 */
	private pruneOldSessions(): void {
		const sessions = this.getSessions()
		const overflow = sessions.length - MAX_SESSIONS
		if (overflow <= 0) return

		// Only prune non-running sessions
		const nonRunning = sessions.filter((s) => s.status !== "running")
		if (nonRunning.length === 0) return

		// Sessions are sorted most-recent-first, so slice from the end to get oldest
		const toRemove = nonRunning.slice(-Math.min(overflow, nonRunning.length))

		for (const session of toRemove) {
			this.sessions.delete(session.id)
		}
	}

	private generateId(): string {
		return `session-${randomUUID()}`
	}

	private truncatePrompt(prompt: string, maxLength = 40): string {
		const cleaned = prompt.replace(/\s+/g, " ").trim()
		if (cleaned.length <= maxLength) {
			return cleaned
		}
		return cleaned.substring(0, maxLength - 3) + "..."
	}
}
