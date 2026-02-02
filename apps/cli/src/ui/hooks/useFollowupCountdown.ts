import { useEffect, useRef } from "react"
import { FOLLOWUP_TIMEOUT_SECONDS } from "../../types/constants.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import type { PendingAsk } from "../types.js"

export interface UseFollowupCountdownOptions {
	pendingAsk: PendingAsk | null
	onAutoSubmit: (text: string) => void
}

/**
 * Hook to manage auto-accept countdown timer for followup questions with suggestions.
 *
 * When a followup question appears with suggestions (and not in custom input mode),
 * starts a countdown timer that auto-submits the first suggestion when it reaches zero.
 *
 * The countdown can be canceled by:
 * - User navigating with arrow keys
 * - User switching to custom input mode
 * - Followup question changing/disappearing
 */
export function useFollowupCountdown({ pendingAsk, onAutoSubmit }: UseFollowupCountdownOptions) {
	const { showCustomInput, countdownSeconds, setCountdownSeconds } = useUIStateStore()
	const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)

	// Use ref for onAutoSubmit to avoid stale closure issues without needing it in dependencies
	const onAutoSubmitRef = useRef(onAutoSubmit)
	useEffect(() => {
		onAutoSubmitRef.current = onAutoSubmit
	}, [onAutoSubmit])

	// Cleanup interval on unmount
	useEffect(() => {
		return () => {
			if (countdownIntervalRef.current) {
				clearInterval(countdownIntervalRef.current)
			}
		}
	}, [])

	// Start countdown when a followup question with suggestions appears
	useEffect(() => {
		// Clear any existing countdown
		if (countdownIntervalRef.current) {
			clearInterval(countdownIntervalRef.current)
			countdownIntervalRef.current = null
		}

		// Only start countdown for followup questions with suggestions (not custom input mode)
		if (
			pendingAsk?.type === "followup" &&
			pendingAsk.suggestions &&
			pendingAsk.suggestions.length > 0 &&
			!showCustomInput
		) {
			// Start countdown
			setCountdownSeconds(FOLLOWUP_TIMEOUT_SECONDS)

			countdownIntervalRef.current = setInterval(() => {
				const currentSeconds = useUIStateStore.getState().countdownSeconds
				if (currentSeconds === null || currentSeconds <= 1) {
					// Time's up! Auto-select first option
					if (countdownIntervalRef.current) {
						clearInterval(countdownIntervalRef.current)
						countdownIntervalRef.current = null
					}
					setCountdownSeconds(null)
					// Auto-submit the first suggestion
					if (pendingAsk?.suggestions && pendingAsk.suggestions.length > 0) {
						const firstSuggestion = pendingAsk.suggestions[0]
						if (firstSuggestion) {
							onAutoSubmitRef.current(firstSuggestion.answer)
						}
					}
				} else {
					setCountdownSeconds(currentSeconds - 1)
				}
			}, 1000)
		} else {
			// Only set to null if not already null to prevent unnecessary state updates
			// This is critical to avoid infinite render loops
			if (countdownSeconds !== null) {
				setCountdownSeconds(null)
			}
		}

		return () => {
			if (countdownIntervalRef.current) {
				clearInterval(countdownIntervalRef.current)
				countdownIntervalRef.current = null
			}
		}
		// Note: countdownSeconds is intentionally NOT in deps - we only read it to avoid
		// unnecessary state updates, not to react to its changes
	}, [pendingAsk?.id, pendingAsk?.type, showCustomInput, setCountdownSeconds])

	/**
	 * Cancel the countdown timer (called when user interacts with the menu)
	 */
	const cancelCountdown = () => {
		if (countdownIntervalRef.current) {
			clearInterval(countdownIntervalRef.current)
			countdownIntervalRef.current = null
		}
		setCountdownSeconds(null)
	}

	return {
		countdownSeconds,
		cancelCountdown,
	}
}
