/**
 * Agent Manager Types
 */

export type AgentStatus = "running" | "done" | "error" | "stopped"
export type SessionSource = "local" | "remote"

export interface AgentSession {
	localId: string
	label: string
	prompt: string
	status: AgentStatus
	startTime: number
	endTime?: number
	exitCode?: number
	error?: string
	logs: string[]
	pid?: number
	sessionId?: string
	source: SessionSource
}

export interface RemoteSession {
	session_id: string
	title: string
	created_at: string
	updated_at: string
}

export interface AgentManagerState {
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
	| { type: "agentManager.removeSession"; sessionId: string }
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
