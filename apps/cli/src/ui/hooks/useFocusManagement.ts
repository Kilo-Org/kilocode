import { useEffect } from "react"
import { useUIStateStore } from "../stores/uiStateStore.js"
import type { PendingAsk } from "../types.js"

export interface UseFocusManagementOptions {
	showApprovalPrompt: boolean
	pendingAsk: PendingAsk | null
}

export interface UseFocusManagementReturn {
	/** Whether focus can be toggled between scroll and input areas */
	canToggleFocus: boolean
	/** Whether scroll area should capture keyboard input */
	isScrollAreaActive: boolean
	/** Whether input area is active (for visual focus indicator) */
	isInputAreaActive: boolean
	/** Manual focus override */
	manualFocus: "scroll" | "input" | null
	/** Set manual focus override */
	setManualFocus: (focus: "scroll" | "input" | null) => void
	/** Toggle focus between scroll and input */
	toggleFocus: () => void
}

/**
 * Hook to manage focus state between scroll area and input area.
 *
 * Focus can be toggled when text input is available (not showing approval prompt).
 * The hook automatically resets manual focus when the view changes.
 */
export function useFocusManagement({
	showApprovalPrompt,
	pendingAsk,
}: UseFocusManagementOptions): UseFocusManagementReturn {
	const { showCustomInput, manualFocus, setManualFocus } = useUIStateStore()

	// Determine if we're in a mode where focus can be toggled (text input is available)
	const canToggleFocus =
		!showApprovalPrompt &&
		(!pendingAsk || // Initial input or task complete or loading
			pendingAsk.type === "followup" || // Followup question with suggestions or custom input
			showCustomInput) // Custom input mode

	// Determine if scroll area should capture keyboard input
	const isScrollAreaActive: boolean =
		manualFocus === "scroll" ? true : manualFocus === "input" ? false : Boolean(showApprovalPrompt)

	// Determine if input area is active (for visual focus indicator)
	const isInputAreaActive: boolean =
		manualFocus === "input" ? true : manualFocus === "scroll" ? false : !showApprovalPrompt

	// Reset manual focus when view changes (e.g., agent starts responding)
	useEffect(() => {
		if (!canToggleFocus) {
			setManualFocus(null)
		}
	}, [canToggleFocus, setManualFocus])

	/**
	 * Toggle focus between scroll and input areas
	 */
	const toggleFocus = () => {
		if (!canToggleFocus) {
			return
		}

		const prev = manualFocus
		if (prev === "scroll") {
			setManualFocus("input")
		} else if (prev === "input") {
			setManualFocus("scroll")
		} else {
			setManualFocus(isScrollAreaActive ? "input" : "scroll")
		}
	}

	return {
		canToggleFocus,
		isScrollAreaActive,
		isInputAreaActive,
		manualFocus,
		setManualFocus,
		toggleFocus,
	}
}
