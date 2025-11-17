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

	const token = config?.kilocodeToken

	if (!token) {
		logs.debug("Kilocode token not configured, skipping session creation", "Session")
		return null
	}

	const existingSessionId = get(sessionIdAtom)
	if (existingSessionId) {
		logs.debug("Session already initialized", "Session", { sessionId: existingSessionId })
		return existingSessionId
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
			body: JSON.stringify({ title: "..." }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Failed to create session: ${response.status} ${errorText}`)
		}

		const data = await response.json()

		const sessionId = data?.result?.data?.session_id

		if (!sessionId) {
			logs.error("Failed to parse session ID from response", "Session", { data })
			throw new Error("Invalid session response from backend")
		}

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
