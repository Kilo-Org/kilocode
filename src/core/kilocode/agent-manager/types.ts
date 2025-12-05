import type { Session } from "../../../shared/kilocode/cli-sessions/core/SessionClient"
export type RemoteSession = Session

/**
 * Agent Manager Types
 */

export type AgentStatus = "creating" | "running" | "done" | "error" | "stopped"
export type SessionSource = "local" | "remote"

export interface AgentSession {
	sessionId: string
	label: string
	prompt: string
	status: AgentStatus
	startTime: number
	endTime?: number
	exitCode?: number
	error?: string
	logs: string[]
	pid?: number
	source: SessionSource
	gitUrl?: string
}

/**
 * Represents a session that is being created (waiting for CLI's session_created event)
 */
export interface PendingSession {
	prompt: string
	label: string
	startTime: number
	gitUrl?: string
}

export type AgentManagerState = {
	sessions: AgentSession[]
	selectedId: string | null
}

/**
 * Messages from Webview to Extension
 */
export type AgentManagerMessage =
	| { type: "agentManager.webviewReady" }
	| { type: "agentManager.startSession"; prompt: string }
	| { type: "agentManager.stopSession"; sessionId: string }
	| { type: "agentManager.selectSession"; sessionId: string }
	| { type: "agentManager.refreshRemoteSessions" }

/**
 * Messages from Extension to Webview
 */
export type AgentManagerExtensionMessage =
	| { type: "agentManager.state"; state: AgentManagerState }
	| { type: "agentManager.sessionUpdated"; session: AgentSession }
	| { type: "agentManager.sessionRemoved"; sessionId: string }
	| { type: "agentManager.error"; error: string }
	| { type: "agentManager.remoteSessions"; sessions: RemoteSession[] }
