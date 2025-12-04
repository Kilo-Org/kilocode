import { atom } from "jotai"

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

// Core atoms
export const sessionsMapAtom = atom<Record<string, AgentSession>>({})
export const sessionOrderAtom = atom<string[]>([])
export const selectedSessionIdAtom = atom<string | null>(null)
export const remoteSessionsAtom = atom<RemoteSession[]>([])
export const isRefreshingRemoteSessionsAtom = atom(false)

export const startSessionFailedCounterAtom = atom(0)

// Derived - local sessions only
export const sessionsArrayAtom = atom((get) => {
	const map = get(sessionsMapAtom)
	const order = get(sessionOrderAtom)
	return order.map((id) => map[id]).filter((s): s is AgentSession => s !== undefined)
})

function toAgentSession(remote: RemoteSession): AgentSession {
	return {
		localId: remote.session_id,
		label: remote.title || "Untitled",
		prompt: "",
		status: "done",
		startTime: new Date(remote.created_at).getTime(),
		endTime: new Date(remote.updated_at).getTime(),
		source: "remote",
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
	const isNewSession = !order.includes(session.localId)

	set(sessionsMapAtom, { ...current, [session.localId]: session })
	if (isNewSession) {
		set(sessionOrderAtom, [session.localId, ...order])
		if (get(selectedSessionIdAtom) === null) {
			set(selectedSessionIdAtom, session.localId)
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

export const startRefreshingRemoteSessionsAtom = atom(null, (_get, set) => {
	set(isRefreshingRemoteSessionsAtom, true)
})
