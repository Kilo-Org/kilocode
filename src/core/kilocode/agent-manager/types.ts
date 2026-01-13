import type { Session as RemoteSession } from "../../../shared/kilocode/cli-sessions/core/SessionClient"

/**
 * Agent Manager Types
 */

export type AgentStatus = "creating" | "running" | "done" | "error" | "stopped"
export type SessionSource = "local" | "remote"

/**
 * Parallel mode (worktree) information for a session
 */
export interface ParallelModeInfo {
	enabled: boolean
	branch?: string // e.g., "add-authentication-1702734891234"
	worktreePath?: string // e.g., ".kilocode/worktrees/add-auth..."
	parentBranch?: string // e.g., "main" - the branch worktree was created from
	completionMessage?: string // Merge instructions from CLI on completion
}

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
	parallelMode?: ParallelModeInfo
	gitUrl?: string
}

/**
 * Represents a session that is being created (waiting for CLI's session_created event)
 */
export interface PendingSession {
	prompt: string
	label: string
	startTime: number
	parallelMode?: boolean
	gitUrl?: string
}

// Re-export remote session shape from shared session client for consistency
export type { RemoteSession }

export interface AgentManagerState {
	sessions: AgentSession[]
	selectedId: string | null
}

/**
 * Messages from Webview to Extension
 */
export type AgentManagerMessage =
	| { type: "agentManager.webviewReady" }
	| { type: "agentManager.startSession"; prompt: string; parallelMode?: boolean; existingBranch?: string }
	| { type: "agentManager.stopSession"; sessionId: string }
	| { type: "agentManager.selectSession"; sessionId: string }
	| { type: "agentManager.refreshRemoteSessions" }
	| { type: "agentManager.listBranches" }

/**
 * Messages from Extension to Webview
 */
export type AgentManagerExtensionMessage =
	| { type: "agentManager.state"; state: AgentManagerState }
	| { type: "agentManager.sessionUpdated"; session: AgentSession }
	| { type: "agentManager.sessionRemoved"; sessionId: string }
	| { type: "agentManager.error"; error: string }
	| { type: "agentManager.remoteSessions"; sessions: RemoteSession[] }
	| { type: "agentManager.branches"; branches: string[]; currentBranch?: string }
