import { randomUUID } from "node:crypto"
import { AgentSession, AgentStatus, AgentManagerState } from "./types"

const MAX_SESSIONS = 10
const MAX_LOGS = 100

export class AgentRegistry {
	private sessions: Map<string, AgentSession> = new Map()
	private _selectedId: string | null = null

	public get selectedId(): string | null {
		return this._selectedId
	}

	public set selectedId(localId: string | null) {
		this._selectedId = localId && this.sessions.has(localId) ? localId : null
	}

	public createSession(prompt: string): AgentSession {
		const localId = this.generateLocalId()
		const label = this.truncatePrompt(prompt)

		const session: AgentSession = {
			localId,
			label,
			prompt,
			status: "running",
			startTime: Date.now(),
			logs: ["Starting agent..."],
			source: "local",
		}

		this.sessions.set(localId, session)
		this.selectedId = localId
		this.pruneOldSessions()

		return session
	}

	public setSessionIdFor(localId: string, sessionId: string): void {
		const session = this.sessions.get(localId)
		if (session) {
			session.sessionId = sessionId
		}
	}

	public getSessionBySessionId(sessionId: string): AgentSession | undefined {
		for (const session of this.sessions.values()) {
			if (session.sessionId === sessionId) {
				return session
			}
		}
		return undefined
	}

	public hasActiveProcess(localId: string): boolean {
		const session = this.sessions.get(localId)
		return session?.status === "running" && session?.pid !== undefined
	}

	public updateSessionStatus(
		localId: string,
		status: AgentStatus,
		exitCode?: number,
		error?: string,
	): AgentSession | undefined {
		const session = this.sessions.get(localId)
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

	public removeSession(localId: string): boolean {
		const deleted = this.sessions.delete(localId)
		if (deleted && this.selectedId === localId) {
			const sessions = this.getSessions()
			this.selectedId = sessions.length > 0 ? sessions[0].localId : null
		}
		return deleted
	}

	public getSession(localId: string): AgentSession | undefined {
		return this.sessions.get(localId)
	}

	public getSessions(): AgentSession[] {
		return Array.from(this.sessions.values()).sort((a, b) => b.startTime - a.startTime)
	}

	public appendLog(localId: string, line: string): void {
		const session = this.sessions.get(localId)
		if (!session) return

		session.logs.push(line)
		if (session.logs.length > MAX_LOGS) {
			session.logs = session.logs.slice(-MAX_LOGS)
		}
	}

	public setSessionPid(localId: string, pid: number): void {
		const session = this.sessions.get(localId)
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

	private pruneOldSessions(): void {
		const sessions = this.getSessions()
		const overflow = sessions.length - MAX_SESSIONS
		if (overflow <= 0) return

		const nonRunning = sessions.filter((s) => s.status !== "running")
		if (nonRunning.length === 0) return

		const toRemove = nonRunning.slice(-Math.min(overflow, nonRunning.length))

		for (const session of toRemove) {
			this.sessions.delete(session.localId)
		}
	}

	private generateLocalId(): string {
		return `local-${randomUUID()}`
	}

	private truncatePrompt(prompt: string, maxLength = 40): string {
		const cleaned = prompt.replace(/\s+/g, " ").trim()
		if (cleaned.length <= maxLength) {
			return cleaned
		}
		return cleaned.substring(0, maxLength - 3) + "..."
	}
}
