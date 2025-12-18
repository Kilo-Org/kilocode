import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import type { ClineMessage } from "@roo-code/types"
import { updateSessionMessagesAtom } from "../atoms/messages"
import { updateSessionTodosAtom } from "../atoms/todos"
import { updateBranchesAtom } from "../atoms/branches"
import { extractTodosFromMessages } from "./extractTodosFromMessages"
import {
	upsertSessionAtom,
	removeSessionAtom,
	selectedSessionIdAtom,
	startSessionFailedCounterAtom,
	sessionOrderAtom,
	remoteSessionsAtom,
	pendingSessionAtom,
	isRefreshingRemoteSessionsAtom,
	type AgentSession,
	type RemoteSession,
	type PendingSession,
} from "../atoms/sessions"
import { sendSessionEventAtom, cleanupSessionMachineAtom } from "../atoms/stateMachine"
import type { SessionEvent } from "../sessionStateMachine"

interface AgentManagerState {
	sessions: AgentSession[]
	selectedId: string | null
}

interface ChatMessagesMessage {
	type: "agentManager.chatMessages"
	sessionId: string
	messages: ClineMessage[]
}

interface StateMessage {
	type: "agentManager.state"
	state: AgentManagerState
}

interface StartSessionFailedMessage {
	type: "agentManager.startSessionFailed"
}

interface RemoteSessionsMessage {
	type: "agentManager.remoteSessions"
	sessions: RemoteSession[]
}

interface PendingSessionMessage {
	type: "agentManager.pendingSession"
	pendingSession: PendingSession | null
}

interface StateEventMessage {
	type: "agentManager.stateEvent"
	sessionId: string
	eventType: string
	partial?: boolean
}

interface BranchesMessage {
	type: "agentManager.branches"
	branches: string[]
	currentBranch?: string
}

type ExtensionMessage =
	| ChatMessagesMessage
	| StateMessage
	| StartSessionFailedMessage
	| RemoteSessionsMessage
	| PendingSessionMessage
	| StateEventMessage
	| BranchesMessage
	| { type: string; [key: string]: unknown }

/**
 * Maps extension state event types to state machine events.
 */
function mapToStateMachineEvent(eventType: string, partial?: boolean): SessionEvent | null {
	switch (eventType) {
		case "api_req_started":
			return { type: "api_req_started" }

		// Input-required asks
		case "ask_followup":
			// Followups should always transition to waiting_input (partial handling is done in the state machine).
			return { type: "ask_followup", partial: partial ?? false }

		// Approval-required asks
		case "ask_tool":
			return { type: "ask_tool", partial: partial ?? false }
		case "ask_command":
			return { type: "ask_command", partial: partial ?? false }
		case "ask_browser_action_launch":
			return { type: "ask_browser_action_launch", partial: partial ?? false }
		case "ask_use_mcp_server":
			return { type: "ask_use_mcp_server", partial: partial ?? false }

		// Completion
		case "ask_completion_result":
			return { type: "ask_completion_result" }

		// Paused state
		case "ask_resume_task":
			return { type: "ask_resume_task" }

		// Error states
		case "ask_api_req_failed":
			return { type: "ask_api_req_failed" }
		case "ask_mistake_limit_reached":
			return { type: "ask_mistake_limit_reached" }
		case "ask_invalid_model":
			return { type: "ask_invalid_model" }
		case "ask_payment_required_prompt":
			return { type: "ask_payment_required_prompt" }

		// Cancellation
		case "cancel_session":
			return { type: "cancel_session" }

		default:
			return null
	}
}

/**
 * Hook that listens for messages from the extension and updates Jotai state.
 * This bridges the VS Code extension IPC with the Jotai state management.
 */
export function useAgentManagerMessages() {
	const updateSessionMessages = useSetAtom(updateSessionMessagesAtom)
	const updateSessionTodos = useSetAtom(updateSessionTodosAtom)
	const updateBranches = useSetAtom(updateBranchesAtom)
	const upsertSession = useSetAtom(upsertSessionAtom)
	const removeSession = useSetAtom(removeSessionAtom)
	const setSelectedSessionId = useSetAtom(selectedSessionIdAtom)
	const setStartSessionFailedCounter = useSetAtom(startSessionFailedCounterAtom)
	const setRemoteSessions = useSetAtom(remoteSessionsAtom)
	const setPendingSession = useSetAtom(pendingSessionAtom)
	const setIsRefreshingRemoteSessions = useSetAtom(isRefreshingRemoteSessionsAtom)
	const sendSessionEvent = useSetAtom(sendSessionEventAtom)
	const cleanupSessionMachine = useSetAtom(cleanupSessionMachineAtom)
	const sessionOrder = useAtomValue(sessionOrderAtom)
	const hasInitializedSelection = useRef(false)
	const knownSessionsRef = useRef(new Set<string>())

	useEffect(() => {
		function handleMessage(event: MessageEvent<ExtensionMessage>) {
			const message = event.data

			switch (message.type) {
				case "agentManager.chatMessages": {
					const { sessionId, messages } = message as ChatMessagesMessage
					updateSessionMessages({ sessionId, messages })
					// Extract and update todos from messages
					const todos = extractTodosFromMessages(messages)
					updateSessionTodos({ sessionId, todos })
					break
				}

				case "agentManager.state": {
					const { state } = message as StateMessage
					for (const session of state.sessions) {
						// Check if this is a new session we haven't seen before
						const isNewSession = !knownSessionsRef.current.has(session.sessionId)
						upsertSession(session)

						// Send state machine events for new sessions based on status
						if (isNewSession) {
							knownSessionsRef.current.add(session.sessionId)
							if (session.status === "creating" || session.status === "running") {
								sendSessionEvent({
									sessionId: session.sessionId,
									event: { type: "start_session" },
								})
								sendSessionEvent({
									sessionId: session.sessionId,
									event: { type: "session_created", sessionId: session.sessionId },
								})
								// If session is already running, also send api_req_started
								// The state machine needs both session_created AND api_req_started
								// to transition from "creating" to "streaming"
								if (session.status === "running") {
									sendSessionEvent({
										sessionId: session.sessionId,
										event: { type: "api_req_started" },
									})
								}
							}
						}
					}
					const extensionSessionIds = new Set(state.sessions.map((s) => s.sessionId))
					for (const sessionId of sessionOrder) {
						if (!extensionSessionIds.has(sessionId)) {
							removeSession(sessionId)
							cleanupSessionMachine(sessionId)
							knownSessionsRef.current.delete(sessionId)
						}
					}
					if (!hasInitializedSelection.current && state.selectedId !== undefined) {
						setSelectedSessionId(state.selectedId)
						hasInitializedSelection.current = true
					}
					break
				}

				case "agentManager.startSessionFailed": {
					// Increment counter so components can reset their loading state
					setStartSessionFailedCounter((c) => c + 1)
					// Also clear pending session
					setPendingSession(null)
					break
				}

				case "agentManager.remoteSessions": {
					const { sessions } = message as RemoteSessionsMessage
					setRemoteSessions(sessions)
					setIsRefreshingRemoteSessions(false)
					break
				}

				case "agentManager.pendingSession": {
					const { pendingSession } = message as PendingSessionMessage
					setPendingSession(pendingSession)
					break
				}

				case "agentManager.stateEvent": {
					const { sessionId, eventType, partial } = message as StateEventMessage
					// Convert extension state events to state machine events
					const event = mapToStateMachineEvent(eventType, partial)
					if (event) {
						sendSessionEvent({ sessionId, event })
					}
					break
				}

				case "agentManager.branches": {
					const { branches, currentBranch } = message as BranchesMessage
					updateBranches({ branches, currentBranch })
					break
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [
		updateSessionMessages,
		updateSessionTodos,
		updateBranches,
		upsertSession,
		removeSession,
		setSelectedSessionId,
		setStartSessionFailedCounter,
		setRemoteSessions,
		setPendingSession,
		setIsRefreshingRemoteSessions,
		sendSessionEvent,
		cleanupSessionMachine,
		sessionOrder,
	])
}
