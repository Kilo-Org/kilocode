import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import path from "path"
import type { IPathProvider } from "../types/IPathProvider.js"
import type { SessionStateManager } from "../core/SessionStateManager.js"

interface WorkspaceSessionState {
	lastSession?: {
		sessionId: string
		timestamp: number
	}
	taskSessionMap: Record<string, string>
}

export class SessionPersistenceManager {
	private pathProvider: IPathProvider
	private stateManager: SessionStateManager

	constructor(pathProvider: IPathProvider, stateManager: SessionStateManager) {
		this.pathProvider = pathProvider
		this.stateManager = stateManager
	}

	private getSessionStatePath(): string | null {
		const workspaceDir = this.stateManager.getWorkspaceDir()
		if (!workspaceDir) {
			return null
		}
		return this.pathProvider.getSessionFilePath(workspaceDir)
	}

	private readWorkspaceState(): WorkspaceSessionState {
		const statePath = this.getSessionStatePath()
		if (!statePath || !existsSync(statePath)) {
			return { taskSessionMap: {} }
		}

		const content = readFileSync(statePath, "utf-8")
		const data = JSON.parse(content)

		return {
			lastSession: data.lastSession,
			taskSessionMap: data.taskSessionMap || {},
		}
	}

	private writeWorkspaceState(state: WorkspaceSessionState): void {
		const statePath = this.getSessionStatePath()

		if (!statePath) {
			return
		}

		const stateDir = path.dirname(statePath)

		mkdirSync(stateDir, { recursive: true })

		writeFileSync(statePath, JSON.stringify(state, null, 2))
	}

	getLastSession(): { sessionId: string; timestamp: number } | undefined {
		const state = this.readWorkspaceState()

		return state.lastSession
	}

	setLastSession(sessionId: string): void {
		const state = this.readWorkspaceState()

		state.lastSession = { sessionId, timestamp: Date.now() }

		this.writeWorkspaceState(state)
	}

	getTaskSessionMap(): Record<string, string> {
		const state = this.readWorkspaceState()

		return this.deduplicateTaskSessionMap(state.taskSessionMap)
	}

	private deduplicateTaskSessionMap(taskSessionMap: Record<string, string>): Record<string, string> {
		const entries = Object.entries(taskSessionMap)
		const sessionToLastTaskId = new Map<string, string>()

		for (const [taskId, sessionId] of entries) {
			sessionToLastTaskId.set(sessionId, taskId)
		}

		const result: Record<string, string> = {}

		for (const [sessionId, taskId] of sessionToLastTaskId) {
			result[taskId] = sessionId
		}

		return result
	}

	setTaskSessionMap(taskSessionMap: Record<string, string>): void {
		const state = this.readWorkspaceState()

		state.taskSessionMap = taskSessionMap

		this.writeWorkspaceState(state)
	}

	getSessionForTask(taskId: string): string | undefined {
		return this.stateManager.getSessionForTask(taskId) || this.getTaskSessionMap()[taskId]
	}

	setSessionForTask(taskId: string, sessionId: string): void {
		this.stateManager.setSessionForTask(taskId, sessionId)

		const state = this.readWorkspaceState()

		state.taskSessionMap[taskId] = sessionId

		this.writeWorkspaceState(state)
	}
}
