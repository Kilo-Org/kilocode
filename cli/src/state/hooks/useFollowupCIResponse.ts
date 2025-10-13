/**
 * Hook for handling follow-up messages in CI mode
 *
 * This hook automatically sends a response to follow-up questions in CI mode,
 * informing the AI that it should make autonomous decisions.
 *
 * Unlike approval-based messages, follow-up questions don't require approval -
 * they're just questions from the AI. In CI mode, we automatically respond
 * to tell the AI to proceed autonomously.
 *
 * @module useFollowupCIResponse
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { ciModeAtom } from "../atoms/ci.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { CI_MODE_MESSAGES } from "../../constants/ci.js"
import { logs } from "../../services/logs.js"

/**
 * Hook that automatically responds to follow-up questions in CI mode
 *
 * This hook:
 * 1. Detects when a follow-up message arrives
 * 2. If in CI mode, automatically sends a response (not approval)
 * 3. The response tells the AI to make autonomous decisions
 *
 * @param message - The follow-up message to handle
 *
 * @example
 * ```typescript
 * export const AskFollowupMessage = ({ message }) => {
 *   useFollowupCIResponse(message)
 *
 *   // Just render UI
 *   return <Box>...</Box>
 * }
 * ```
 */
export function useFollowupCIResponse(message: ExtensionChatMessage): void {
	const isCIMode = useAtomValue(ciModeAtom)
	const { sendAskResponse } = useWebviewMessage()

	// Track which messages we've already responded to
	const respondedToRef = useRef<Set<number>>(new Set())

	useEffect(() => {
		// Only process in CI mode
		if (!isCIMode) {
			return
		}

		// Skip if message is answered or partial
		if (message.isAnswered || message.partial) {
			return
		}

		// Skip if we've already responded to this message
		if (respondedToRef.current.has(message.ts)) {
			return
		}

		// Mark as responded
		respondedToRef.current.add(message.ts)

		logs.info("CI mode: Auto-responding to follow-up question", "useFollowupCIResponse", {
			ts: message.ts,
		})

		// Send response with CI mode message
		sendAskResponse({
			response: "messageResponse",
			text: CI_MODE_MESSAGES.FOLLOWUP_RESPONSE,
		}).catch((error) => {
			logs.error("CI mode: Failed to respond to follow-up question", "useFollowupCIResponse", {
				error,
			})
		})

		// Cleanup old timestamps to prevent memory leak
		return () => {
			if (respondedToRef.current.size > 100) {
				const timestamps = Array.from(respondedToRef.current)
				const toKeep = timestamps.slice(-100)
				respondedToRef.current = new Set(toKeep)
			}
		}
	}, [message.ts, message.isAnswered, message.partial, isCIMode, sendAskResponse])
}
