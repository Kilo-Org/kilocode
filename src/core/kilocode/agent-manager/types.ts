/**
 * Agent Manager Types
 */

export type AgentStatus = "running" | "done" | "error" | "stopped"

export interface AgentSession {
	id: string
	label: string // Truncated prompt (first ~30 chars)
	prompt: string // Full prompt
	status: AgentStatus
	startTime: number
	endTime?: number
	exitCode?: number
	error?: string
	logs: string[] // Log lines from the agent runner
	pid?: number // Child process PID
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

/**
 * Messages from Extension to Webview
 */
export type AgentManagerExtensionMessage =
	| { type: "agentManager.state"; state: AgentManagerState }
	| { type: "agentManager.sessionUpdated"; session: AgentSession }
	| { type: "agentManager.sessionRemoved"; sessionId: string }
	| { type: "agentManager.error"; error: string }
