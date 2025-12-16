import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { ClineMessage } from "@roo-code/types"
import { sendSessionEventAtom } from "./stateMachine"
import type { SessionEvent } from "../sessionStateMachine"

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

		// Send events for new/updated messages (in order)
		const previous = new Map(current.map((m) => [m.ts, m]))
		for (const msg of reconciled) {
			const prev = previous.get(msg.ts)
			const isNew = !prev
			const becameComplete = prev?.partial && !msg.partial
			if (!isNew && !becameComplete) continue
			const event = messageToEvent(msg)
			if (event) {
				set(sendSessionEventAtom, { sessionId, event })
			}
		}
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
export function getContentLength(msg: ClineMessage): number {
	return (msg.text?.length || 0) + (msg.say?.length || 0) + (msg.ask?.length || 0)
}

export function reconcileMessages(
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

/**
 * Convert a ClineMessage to a SessionEvent for the state machine.
 * Returns null if the message doesn't map to a state-changing event.
 */
export function messageToEvent(msg: ClineMessage): SessionEvent | null {
	const partial = msg.partial ?? false

	// Say messages - check the say field for specific event types
	if (msg.type === "say" && msg.say) {
		switch (msg.say) {
			// API request started - important for transitioning to streaming
			case "api_req_started":
				return { type: "api_req_started" }

			// Text and other say messages - stay streaming
			case "text":
			case "command_output":
			case "user_feedback":
			case "user_feedback_diff":
			case "api_req_finished":
			case "api_req_retried":
			case "completion_result":
			case "shell_integration_warning":
			case "checkpoint_saved":
				return { type: "say_text", partial }

			default:
				return { type: "say_text", partial }
		}
	}

	// Ask messages - depend on ask type
	if (msg.type === "ask" && msg.ask) {
		switch (msg.ask) {
			// Approval-required asks
			case "tool":
				return { type: "ask_tool", partial }
			case "command":
				return { type: "ask_command", partial }
			case "browser_action_launch":
				return { type: "ask_browser_action_launch", partial }
			case "use_mcp_server":
				return { type: "ask_use_mcp_server", partial }

			// Input-required asks
			case "followup":
				return { type: "ask_followup", partial }

			// Completion
			case "completion_result":
				return { type: "ask_completion_result" }

			// Errors
			case "api_req_failed":
				return { type: "ask_api_req_failed" }
			case "mistake_limit_reached":
				return { type: "ask_mistake_limit_reached" }
			case "invalid_model":
				return { type: "ask_invalid_model" }
			case "payment_required_prompt":
				return { type: "ask_payment_required_prompt" }

			// Resumable
			case "resume_task":
				return { type: "ask_resume_task" }
			case "resume_completed_task":
				return { type: "ask_resume_task" }

			default:
				return null
		}
	}

	return null
}
