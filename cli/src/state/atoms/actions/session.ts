/**
 * Session action atoms for managing CLI session lifecycle
 */

import { atom } from "jotai"
import { logs } from "../../../services/logs.js"
import { sessionIdAtom, setSessionIdAtom, setSessionErrorAtom, setSessionInitializingAtom } from "../session.js"
import { configAtom } from "../config.js"

/**
 * Action atom to initialize a new session with the backend
 * This should be called during CLI initialization before allowing usage
 * Session is created regardless of provider if API key is present
 */
export const initializeSessionAtom = atom(null, async (get, set) => {
	const config = get(configAtom)

	// Check if API key is configured
	const apiKey = config?.kilocodeApiKey

	if (!apiKey) {
		logs.debug("Kilocode API key not configured, skipping session creation", "Session")
		return null
	}

	// Check if session is already initialized
	const existingSessionId = get(sessionIdAtom)
	if (existingSessionId) {
		logs.debug("Session already initialized", "Session", { sessionId: existingSessionId })
		return existingSessionId
	}

	set(setSessionInitializingAtom, true)
	logs.info("Initializing CLI session...", "Session")

	try {
		const apiBaseUrl = "https://api.kilocode.app"

		// Create session via API
		const response = await fetch(`${apiBaseUrl}/api/trpc/sessions.create`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ title: "..." }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Failed to create session: ${response.status} ${errorText}`)
		}

		const data = await response.json()

		if (!data.session || !data.session.id) {
			throw new Error("Invalid session response from backend")
		}

		const sessionId = data.session.id
		logs.info("CLI session created successfully", "Session", { sessionId })

		set(setSessionIdAtom, sessionId)
		return sessionId
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logs.error("Failed to initialize CLI session", "Session", { error: err })
		set(setSessionErrorAtom, err)
		throw err
	}
})
