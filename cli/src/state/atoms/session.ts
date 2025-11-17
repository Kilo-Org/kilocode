/**
 * Session-related Jotai atoms for managing CLI session state
 */

import { atom } from "jotai"

/**
 * Atom to hold the current session ID
 * This ID is obtained from the backend during CLI initialization
 * and is used for subsequent API calls that require a session context
 */
export const sessionIdAtom = atom<string | null>(null)

/**
 * Atom to hold the current session title
 */
export const sessionTitleAtom = atom<string | null>(null)

/**
 * Atom to track if session is being initialized
 */
export const isSessionInitializingAtom = atom<boolean>(false)

/**
 * Atom to track session initialization errors
 */
export const sessionErrorAtom = atom<Error | null>(null)

/**
 * Derived atom to check if session is ready
 */
export const isSessionReadyAtom = atom<boolean>((get) => {
	const sessionId = get(sessionIdAtom)
	const isInitializing = get(isSessionInitializingAtom)
	const error = get(sessionErrorAtom)

	return sessionId !== null && !isInitializing && error === null
})

/**
 * Action atom to set the session ID and title
 */
export const setSessionIdAtom = atom(null, (get, set, sessionId: string | null, sessionTitle?: string | null) => {
	set(sessionIdAtom, sessionId)
	set(sessionTitleAtom, sessionTitle ?? null)
	set(isSessionInitializingAtom, false)

	// Clear error when session is set
	if (sessionId) {
		set(sessionErrorAtom, null)
	}
})

/**
 * Action atom to set session error
 */
export const setSessionErrorAtom = atom(null, (get, set, error: Error | null) => {
	set(sessionErrorAtom, error)
	set(isSessionInitializingAtom, false)

	// Clear session ID on error
	if (error) {
		set(sessionIdAtom, null)
	}
})

/**
 * Action atom to set session initializing state
 */
export const setSessionInitializingAtom = atom(null, (get, set, initializing: boolean) => {
	set(isSessionInitializingAtom, initializing)
})

/**
 * Action atom to clear session state
 */
export const clearSessionAtom = atom(null, (get, set) => {
	set(sessionIdAtom, null)
	set(sessionTitleAtom, null)
	set(isSessionInitializingAtom, false)
	set(sessionErrorAtom, null)
})
