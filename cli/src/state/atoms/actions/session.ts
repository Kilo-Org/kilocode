/**
 * Session action atoms for managing CLI session lifecycle
 */

import { atom } from "jotai"
import { logs } from "../../../services/logs.js"
import { sessionIdAtom, setSessionIdAtom, setSessionErrorAtom, setSessionInitializingAtom } from "../session.js"
import { configAtom } from "../config.js"

/**
 * Action atom to validate if a session exists
 * Returns the session ID if valid, null otherwise
 */
export const validateSessionAtom = atom(null, async (get, set, sessionId: string) => {
	const config = get(configAtom)
	const token = config?.kilocodeToken

	if (!token) {
		logs.debug("Kilocode token not configured, cannot validate session", "Session")
		return null
	}

	logs.debug("Validating session", "Session", { sessionId })

	try {
		const apiBaseUrl = process.env.KILOCODE_BACKEND_BASE_URL || "https://api.kilocode.ai"

		const response = await fetch(
			`${apiBaseUrl}/api/trpc/sessions.get?input=${encodeURIComponent(JSON.stringify({ session_id: sessionId }))}`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
			},
		)

		if (!response.ok) {
			logs.warn("Session validation failed", "Session", { sessionId, status: response.status })
			return null
		}

		const data = await response.json()
		const validSessionId = data?.result?.data?.session_id

		if (validSessionId === sessionId) {
			logs.info("Session validated successfully", "Session", { sessionId })
			return sessionId
		}

		logs.warn("Session ID mismatch in validation response", "Session", { sessionId, validSessionId })
		return null
	} catch (error) {
		logs.warn("Failed to validate session", "Session", { error, sessionId })
		return null
	}
})

/**
 * Action atom to initialize a new session with the backend
 * This should be called during CLI initialization before allowing usage
 * Session is created regardless of provider if API key is present
 * If a sessionId is provided, it will be validated first
 * If a title is provided, it will be used as the session title
 */
export const initializeSessionAtom = atom(null, async (get, set, providedSessionId?: string, title?: string) => {
	const config = get(configAtom)

	const token = config?.kilocodeToken

	if (!token) {
		logs.debug("Kilocode token not configured, skipping session creation", "Session")
		return null
	}

	// Check if session is already initialized
	const existingSessionId = get(sessionIdAtom)
	if (existingSessionId) {
		logs.debug("Session already initialized", "Session", { sessionId: existingSessionId })
		return existingSessionId
	}

	// If a session ID was provided, validate it first
	if (providedSessionId) {
		logs.info("Validating provided session ID", "Session", { sessionId: providedSessionId })
		const validatedSessionId = await set(validateSessionAtom, providedSessionId)

		if (validatedSessionId) {
			logs.info("Using validated session ID", "Session", { sessionId: validatedSessionId })
			set(setSessionIdAtom, validatedSessionId, undefined, true) // Mark as resumed
			return validatedSessionId
		}

		logs.info("Provided session ID is invalid, creating new session", "Session", { sessionId: providedSessionId })
	}

	set(setSessionInitializingAtom, true)
	logs.info("Initializing CLI session...", "Session")

	try {
		const apiBaseUrl = process.env.KILOCODE_BACKEND_BASE_URL || "https://api.kilocode.ai"

		const response = await fetch(`${apiBaseUrl}/api/trpc/sessions.create`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ title: title || "" }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Failed to create session: ${response.status} ${errorText}`)
		}

		const data = await response.json()

		const sessionId = data?.result?.data?.session_id
		const sessionTitle = data?.result?.data?.title

		if (!sessionId) {
			logs.error("Failed to parse session ID from response", "Session", { data })
			throw new Error("Invalid session response from backend")
		}

		logs.info("CLI session created successfully", "Session", { sessionId, sessionTitle })

		set(setSessionIdAtom, sessionId, sessionTitle, false) // Mark as new session
		return sessionId
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logs.error("Failed to initialize CLI session", "Session", { error: err })
		set(setSessionErrorAtom, err)
		throw err
	}
})
