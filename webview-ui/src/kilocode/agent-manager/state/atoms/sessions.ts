import { atom } from "jotai"

export type AgentStatus = "running" | "done" | "error" | "stopped"

export interface AgentSession {
	id: string
	label: string
	prompt: string
	status: AgentStatus
	startTime: number
	endTime?: number
	exitCode?: number
	error?: string
	pid?: number
}

// Core atoms
export const sessionsMapAtom = atom<Record<string, AgentSession>>({})
export const sessionOrderAtom = atom<string[]>([])
export const selectedSessionIdAtom = atom<string | null>(null)

// Tracks when a session start attempt fails (e.g., no workspace folder)
// Incremented each time a failure occurs so components can react
export const startSessionFailedCounterAtom = atom(0)

// Derived
export const sessionsArrayAtom = atom((get) => {
	const map = get(sessionsMapAtom)
	const order = get(sessionOrderAtom)
	return order.map((id) => map[id]).filter((s): s is AgentSession => s !== undefined)
})

export const selectedSessionAtom = atom((get) => {
	const id = get(selectedSessionIdAtom)
	return id ? get(sessionsMapAtom)[id] || null : null
})

// Actions
export const upsertSessionAtom = atom(null, (get, set, session: AgentSession) => {
	const current = get(sessionsMapAtom)
	const order = get(sessionOrderAtom)
	const isNewSession = !order.includes(session.id)

	set(sessionsMapAtom, { ...current, [session.id]: session })
	if (isNewSession) {
		set(sessionOrderAtom, [session.id, ...order])
		// Auto-select newly created sessions if user is on "New Agent" view
		if (get(selectedSessionIdAtom) === null) {
			set(selectedSessionIdAtom, session.id)
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
