import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { ClineMessage } from "@roo-code/types"

// Per-session messages using atomFamily
export const sessionMessagesAtomFamily = atomFamily((_sessionId: string) => atom<ClineMessage[]>([]))

// Version tracking for reconciliation (per session)
export const sessionMessageVersionsAtomFamily = atomFamily((_sessionId: string) => atom<Map<number, number>>(new Map()))

// Derived: last message per session
export const lastSessionMessageAtomFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const messages = get(sessionMessagesAtomFamily(sessionId))
		return messages[messages.length - 1] || null
	}),
)

// Derived: check if session has messages
export const hasSessionMessagesAtomFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const messages = get(sessionMessagesAtomFamily(sessionId))
		return messages.length > 0
	}),
)

// Actions
export const updateSessionMessagesAtom = atom(
	null,
	(get, set, payload: { sessionId: string; messages: ClineMessage[] }) => {
		const { sessionId, messages } = payload
		const current = get(sessionMessagesAtomFamily(sessionId))
		const versions = get(sessionMessageVersionsAtomFamily(sessionId))

		// Reconcile to prevent streaming flicker
		const reconciled = reconcileMessages(current, messages, versions)
		set(sessionMessagesAtomFamily(sessionId), reconciled)

		// Update version map
		const newVersions = new Map<number, number>()
		reconciled.forEach((m) => newVersions.set(m.ts, getContentLength(m)))
		set(sessionMessageVersionsAtomFamily(sessionId), newVersions)
	},
)

export const updateSessionMessageByTsAtom = atom(
	null,
	(get, set, payload: { sessionId: string; message: ClineMessage }) => {
		const { sessionId, message } = payload
		const messages = get(sessionMessagesAtomFamily(sessionId))
		const idx = messages.findIndex((m) => m.ts === message.ts)
		if (idx === -1) return

		const newMessages = [...messages]
		newMessages[idx] = message
		set(sessionMessagesAtomFamily(sessionId), newMessages)

		// Update version
		const versions = get(sessionMessageVersionsAtomFamily(sessionId))
		const newVersions = new Map(versions)
		newVersions.set(message.ts, getContentLength(message))
		set(sessionMessageVersionsAtomFamily(sessionId), newVersions)
	},
)

export const clearSessionMessagesAtom = atom(null, (_get, set, sessionId: string) => {
	set(sessionMessagesAtomFamily(sessionId), [])
	set(sessionMessageVersionsAtomFamily(sessionId), new Map())
})

// Helpers - adapted from cli/src/state/atoms/extension.ts
function getContentLength(msg: ClineMessage): number {
	return (msg.text?.length || 0) + (msg.say?.length || 0) + (msg.ask?.length || 0)
}

function reconcileMessages(
	current: ClineMessage[],
	incoming: ClineMessage[],
	versions: Map<number, number>,
): ClineMessage[] {
	const currentMap = new Map(current.map((m) => [m.ts, m]))

	return incoming.map((incomingMsg) => {
		const existing = currentMap.get(incomingMsg.ts)
		if (!existing) return incomingMsg

		// Protect completed messages from partial rollback
		if (!existing.partial && incomingMsg.partial) {
			const currentLen = versions.get(incomingMsg.ts) || 0
			if (getContentLength(incomingMsg) <= currentLen) {
				return existing
			}
		}

		return incomingMsg
	})
}
