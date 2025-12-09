/**
 * Jotai atoms for session state machines.
 *
 * Wraps the state machine to provide reactive state management for each session.
 */
import { atom } from "jotai"
import {
	createSessionStateMachine,
	type SessionStateMachine,
	type SessionEvent,
	type SessionState,
	type SessionUiState,
} from "../sessionStateMachine"
import { selectedSessionIdAtom } from "./sessions"

// Map of session ID to state machine instance
const sessionStateMachines = new Map<string, SessionStateMachine>()

/**
 * Reset all state machines. Only for testing.
 */
export function __resetStateMachines() {
	sessionStateMachines.clear()
}

/**
 * Get or create a state machine for a session.
 */
function getOrCreateMachine(sessionId: string): SessionStateMachine {
	let machine = sessionStateMachines.get(sessionId)
	if (!machine) {
		machine = createSessionStateMachine()
		sessionStateMachines.set(sessionId, machine)
	}
	return machine
}

/**
 * Stores the current state for each session (triggers Jotai reactivity).
 */
export const sessionMachineStateAtom = atom<Record<string, SessionState>>({})

/**
 * Stores the UI state for each session (triggers Jotai reactivity).
 */
export const sessionMachineUiStateAtom = atom<Record<string, SessionUiState>>({})

/**
 * Send an event to a session's state machine.
 * This will update the machine state and trigger Jotai reactivity.
 */
export const sendSessionEventAtom = atom(null, (get, set, payload: { sessionId: string; event: SessionEvent }) => {
	const { sessionId, event } = payload
	const machine = getOrCreateMachine(sessionId)

	machine.send(event)

	// Update atoms to trigger reactivity
	const currentStates = get(sessionMachineStateAtom)
	const currentUiStates = get(sessionMachineUiStateAtom)

	set(sessionMachineStateAtom, {
		...currentStates,
		[sessionId]: machine.getState(),
	})

	set(sessionMachineUiStateAtom, {
		...currentUiStates,
		[sessionId]: machine.getUiState(),
	})
})

/**
 * Reset a session's state machine to idle.
 */
export const resetSessionMachineAtom = atom(null, (get, set, sessionId: string) => {
	const machine = sessionStateMachines.get(sessionId)
	if (machine) {
		machine.reset()

		const currentStates = get(sessionMachineStateAtom)
		const currentUiStates = get(sessionMachineUiStateAtom)

		set(sessionMachineStateAtom, {
			...currentStates,
			[sessionId]: machine.getState(),
		})

		set(sessionMachineUiStateAtom, {
			...currentUiStates,
			[sessionId]: machine.getUiState(),
		})
	}
})

/**
 * Clean up a session's state machine (e.g., when session is removed).
 */
export const cleanupSessionMachineAtom = atom(null, (_get, _set, sessionId: string) => {
	sessionStateMachines.delete(sessionId)
})

/**
 * Get the state for the selected session.
 */
export const selectedSessionMachineStateAtom = atom((get) => {
	const sessionId = get(selectedSessionIdAtom)
	if (!sessionId) return null

	const states = get(sessionMachineStateAtom)
	return states[sessionId] ?? null
})

/**
 * Get the UI state for the selected session.
 */
export const selectedSessionMachineUiStateAtom = atom((get) => {
	const sessionId = get(selectedSessionIdAtom)
	if (!sessionId) return null

	const uiStates = get(sessionMachineUiStateAtom)
	return uiStates[sessionId] ?? null
})

/**
 * Derived: should show spinner for a session.
 * Falls back to false if no state machine exists.
 */
export const sessionShowSpinnerAtom = atom((get) => {
	const uiStates = get(sessionMachineUiStateAtom)
	return (sessionId: string) => uiStates[sessionId]?.showSpinner ?? false
})

/**
 * Derived: should show cancel button for a session.
 */
export const sessionShowCancelButtonAtom = atom((get) => {
	const uiStates = get(sessionMachineUiStateAtom)
	return (sessionId: string) => uiStates[sessionId]?.showCancelButton ?? false
})

/**
 * Derived: is session active (creating, streaming, waiting).
 */
export const sessionIsActiveAtom = atom((get) => {
	const uiStates = get(sessionMachineUiStateAtom)
	return (sessionId: string) => uiStates[sessionId]?.isActive ?? false
})
