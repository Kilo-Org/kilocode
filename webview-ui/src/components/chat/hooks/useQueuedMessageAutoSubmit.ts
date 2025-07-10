import { useEffect, useRef } from "react"

interface UseQueuedMessageAutoSubmitProps {
	sendingDisabled: boolean
	isInQueuedState: boolean
	inputValue: string
	selectedImages: string[]
	onAutoSubmit: (message: string, images: string[]) => void
	clearQueuedState: () => void
}

/**
 * Custom hook to handle auto-submission of queued messages when agent becomes idle.
 *
 * ARCHITECTURAL NOTE: Ideally, this auto-submit logic would be handled on the core
 * extension side for better separation of concerns and more robust state management.
 * However, implementing it there would require significant changes to the core message
 * handling system, which is more likely to conflict with upstream changes from Roo.
 *
 * By implementing this as a React hook in the webview, we can:
 * - Minimize conflicts with upstream Roo updates
 * - Keep the logic contained within the UI layer where it's easier to maintain
 * - Leverage React's built-in state management and lifecycle hooks
 * - Make targeted changes without affecting core extension architecture
 *
 * This hook monitors the sendingDisabled state and triggers auto-submit with the
 * current input value when the agent transitions from busy to idle.
 */
export function useQueuedMessageAutoSubmit({
	sendingDisabled,
	isInQueuedState,
	inputValue,
	selectedImages,
	onAutoSubmit,
	clearQueuedState,
}: UseQueuedMessageAutoSubmitProps) {
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const prevSendingDisabledRef = useRef(sendingDisabled)

	useEffect(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}

		const justBecameIdle = prevSendingDisabledRef.current === true && sendingDisabled === false
		prevSendingDisabledRef.current = sendingDisabled

		// Only proceed if agent just became idle and we have a queued message
		if (justBecameIdle && isInQueuedState) {
			timeoutRef.current = setTimeout(() => {
				// Submit whatever is currently in the input box
				if (isInQueuedState && !sendingDisabled) {
					const trimmedInput = inputValue.trim()
					if (trimmedInput || selectedImages.length > 0) {
						onAutoSubmit(trimmedInput, selectedImages)
						clearQueuedState()
					}
				}

				timeoutRef.current = null
			}, 500)
		}

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
				timeoutRef.current = null
			}
		}
	}, [sendingDisabled, isInQueuedState, inputValue, selectedImages, onAutoSubmit, clearQueuedState])
}
