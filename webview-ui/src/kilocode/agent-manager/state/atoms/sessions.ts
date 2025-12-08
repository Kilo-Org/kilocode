import { atom } from "jotai"

export type AgentStatus = "creating" | "running" | "done" | "error" | "stopped"
export type SessionSource = "local" | "remote"

export interface ParallelModeInfo {
	enabled: boolean
	branch?: string
	worktreePath?: string
	completionMessage?: string
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

export interface RemoteSession {
	session_id: string
	title: string
	created_at: string
	updated_at: string
	git_url?: string
}

// Core atoms
export const sessionsMapAtom = atom<Record<string, AgentSession>>({})
export const sessionOrderAtom = atom<string[]>([])
export const selectedSessionIdAtom = atom<string | null>(null)
export const remoteSessionsAtom = atom<RemoteSession[]>([])
export const isRefreshingRemoteSessionsAtom = atom(false)
export const pendingSessionAtom = atom<PendingSession | null>(null)

export const startSessionFailedCounterAtom = atom(0)

// User preference for run mode (persisted across new agent forms)
export type RunMode = "local" | "worktree"
// Default to local until worktree mode is ready to ship
export const preferredRunModeAtom = atom<RunMode>("local")

// Derived - local sessions only
export const sessionsArrayAtom = atom((get) => {
	const map = get(sessionsMapAtom)
	const order = get(sessionOrderAtom)
	return order.map((id) => map[id]).filter((s): s is AgentSession => s !== undefined)
})

function toAgentSession(remote: RemoteSession): AgentSession {
	// Parse dates safely - invalid dates will produce NaN from getTime()
	const createdTime = remote.created_at ? new Date(remote.created_at).getTime() : 0
	const updatedTime = remote.updated_at ? new Date(remote.updated_at).getTime() : 0

	return {
		sessionId: remote.session_id,
		label: remote.title || "Untitled",
		prompt: "",
		status: "done",
		// Use 0 as fallback if dates are invalid (NaN)
		startTime: Number.isNaN(createdTime) ? 0 : createdTime,
		endTime: Number.isNaN(updatedTime) ? 0 : updatedTime,
		source: "remote",
		gitUrl: remote.git_url,
	}
}

// Merged sessions: local sessions + remote sessions (deduplicated)
export const mergedSessionsAtom = atom((get) => {
	const localSessions = get(sessionsArrayAtom)
	const remoteSessions = get(remoteSessionsAtom)

	// Build set of session IDs we already have locally
	const localSessionIds = new Set(localSessions.filter((s) => s.sessionId).map((s) => s.sessionId))

	// Convert remote sessions, excluding those we already have locally
	const remoteAsDisplay = remoteSessions.filter((rs) => !localSessionIds.has(rs.session_id)).map(toAgentSession)

	// Local sessions first (may be running), then remote sessions (completed)
	return [...localSessions, ...remoteAsDisplay]
})

export const selectedSessionAtom = atom((get) => {
	const id = get(selectedSessionIdAtom)
	if (!id) return null

	// First check local sessions map
	const localSession = get(sessionsMapAtom)[id]
	if (localSession) return localSession

	// Then check remote sessions (converted to AgentSession format)
	const remoteSessions = get(remoteSessionsAtom)
	const remoteSession = remoteSessions.find((rs) => rs.session_id === id)
	if (remoteSession) return toAgentSession(remoteSession)

	return null
})

// Actions
export const upsertSessionAtom = atom(null, (get, set, session: AgentSession) => {
	const current = get(sessionsMapAtom)
	const order = get(sessionOrderAtom)
	const isNewSession = !order.includes(session.sessionId)

	set(sessionsMapAtom, { ...current, [session.sessionId]: session })
	if (isNewSession) {
		set(sessionOrderAtom, [session.sessionId, ...order])
		if (get(selectedSessionIdAtom) === null) {
			set(selectedSessionIdAtom, session.sessionId)
		}
	}
})

export const removeSessionAtom = atom(null, (get, set, sessionId: string) => {
	const current = get(sessionsMapAtom)
	const { [sessionId]: _, ...rest } = current
	set(sessionsMapAtom, rest)
	set(
		sessionOrderAtom,
		get(sessionOrderAtom).filter((id) => id !== sessionId),
	)
	if (get(selectedSessionIdAtom) === sessionId) {
		const remaining = get(sessionOrderAtom)
		set(selectedSessionIdAtom, remaining[0] || null)
	}
})

export const updateSessionStatusAtom = atom(
	null,
	(
		get,
		set,
		payload: {
			sessionId: string
			status: AgentStatus
			exitCode?: number
			error?: string
		},
	) => {
		const current = get(sessionsMapAtom)
		const session = current[payload.sessionId]
		if (!session) return

		set(sessionsMapAtom, {
			...current,
			[payload.sessionId]: {
				...session,
				status: payload.status,
				exitCode: payload.exitCode,
				error: payload.error,
				endTime: payload.status !== "running" ? Date.now() : session.endTime,
			},
		})
	},
)

export const setRemoteSessionsAtom = atom(null, (_get, set, sessions: RemoteSession[]) => {
	set(remoteSessionsAtom, sessions)
	set(isRefreshingRemoteSessionsAtom, false)
})
