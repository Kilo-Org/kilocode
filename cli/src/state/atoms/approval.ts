import { atom } from "jotai"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { logs } from "../../services/logs.js"
import { selectedIndexAtom } from "./ui.js"

/**
 * Approval option interface
 */
export interface ApprovalOption {
	label: string
	action: "approve" | "reject"
	hotkey: string
	color: "green" | "red"
}

/**
 * Approval processing state to track ongoing operations
 */
interface ApprovalProcessingState {
	/** Whether an approval/rejection is currently being processed */
	isProcessing: boolean
	/** Timestamp of the message being processed */
	processingTs?: number
	/** Type of operation being processed */
	operation?: "approve" | "reject"
}

/**
 * Atom to hold the message currently awaiting approval
 */
export const pendingApprovalAtom = atom<ExtensionChatMessage | null>(null)

/**
 * Atom to track approval processing state (prevents duplicate operations)
 */
export const approvalProcessingAtom = atom<ApprovalProcessingState>({
	isProcessing: false,
})

/**
 * @deprecated Use selectedIndexAtom from ui.ts instead
 */
export const selectedApprovalIndexAtom = selectedIndexAtom

/**
 * Derived atom to check if there's a pending approval
 */
export const isApprovalPendingAtom = atom<boolean>((get) => {
	const pending = get(pendingApprovalAtom)
	const processing = get(approvalProcessingAtom)
	// Only show as pending if not currently processing
	return pending !== null && !processing.isProcessing
})

/**
 * Derived atom to get approval options based on the pending message type
 */
export const approvalOptionsAtom = atom<ApprovalOption[]>((get) => {
	const pendingMessage = get(pendingApprovalAtom)

	if (!pendingMessage || pendingMessage.type !== "ask") {
		return []
	}

	// Determine button labels based on ask type
	let approveLabel = "Approve"
	const rejectLabel = "Reject"

	if (pendingMessage.ask === "tool") {
		try {
			const toolData = JSON.parse(pendingMessage.text || "{}")
			const tool = toolData.tool

			if (
				["editedExistingFile", "appliedDiff", "newFileCreated", "insertContent", "generateImage"].includes(tool)
			) {
				approveLabel = "Save"
			}
		} catch {
			// Keep default labels
		}
	} else if (pendingMessage.ask === "command") {
		approveLabel = "Run Command"
	}

	return [
		{
			label: approveLabel,
			action: "approve" as const,
			hotkey: "y",
			color: "green" as const,
		},
		{
			label: rejectLabel,
			action: "reject" as const,
			hotkey: "n",
			color: "red" as const,
		},
	]
})

/**
 * Action atom to set the pending approval message
 * This is an atomic operation that ensures proper state transitions
 */
export const setPendingApprovalAtom = atom(null, (get, set, message: ExtensionChatMessage | null) => {
	const processing = get(approvalProcessingAtom)

	// Don't set pending approval if we're currently processing an approval
	if (processing.isProcessing) {
		logs.debug("Skipping setPendingApproval - approval is being processed", "approval", {
			processingTs: processing.processingTs,
			newTs: message?.ts,
		})
		return
	}

	// Don't set if message is already answered
	if (message?.isAnswered) {
		logs.debug("Skipping setPendingApproval - message already answered", "approval", {
			ts: message.ts,
		})
		return
	}

	logs.debug("Setting pending approval", "approval", {
		ts: message?.ts,
		ask: message?.ask,
		text: message?.text?.substring(0, 100),
	})

	set(pendingApprovalAtom, message)
	set(selectedIndexAtom, 0) // Reset selection
})

/**
 * Action atom to clear the pending approval
 * This is an atomic operation that ensures proper cleanup
 */
export const clearPendingApprovalAtom = atom(null, (get, set) => {
	const current = get(pendingApprovalAtom)
	const processing = get(approvalProcessingAtom)

	if (current) {
		logs.debug("Clearing pending approval atom", "approval", {
			ts: current.ts,
			ask: current.ask,
			wasProcessing: processing.isProcessing,
		})
	}

	set(pendingApprovalAtom, null)
	set(selectedIndexAtom, 0)

	// Also clear processing state if it matches
	if (processing.isProcessing && processing.processingTs === current?.ts) {
		set(approvalProcessingAtom, { isProcessing: false })
	}
})

/**
 * Action atom to start processing an approval/rejection
 * This prevents duplicate operations by marking the message as being processed
 */
export const startApprovalProcessingAtom = atom(null, (get, set, operation: "approve" | "reject") => {
	const pending = get(pendingApprovalAtom)
	const processing = get(approvalProcessingAtom)

	if (!pending) {
		logs.warn("Cannot start approval processing - no pending approval", "approval")
		return false
	}

	if (processing.isProcessing) {
		logs.warn("Cannot start approval processing - already processing", "approval", {
			currentTs: processing.processingTs,
			newTs: pending.ts,
		})
		return false
	}

	logs.debug("Starting approval processing", "approval", {
		ts: pending.ts,
		operation,
	})

	set(approvalProcessingAtom, {
		isProcessing: true,
		processingTs: pending.ts,
		operation,
	})

	return true
})

/**
 * Action atom to complete approval/rejection processing
 * This clears both the pending approval and processing state atomically
 */
export const completeApprovalProcessingAtom = atom(null, (get, set) => {
	const processing = get(approvalProcessingAtom)

	logs.debug("Completing approval processing", "approval", {
		ts: processing.processingTs,
		operation: processing.operation,
	})

	// Clear both pending approval and processing state atomically
	set(pendingApprovalAtom, null)
	set(selectedIndexAtom, 0)
	set(approvalProcessingAtom, { isProcessing: false })
})

/**
 * Action atom to select the next approval option
 */
export const selectNextApprovalAtom = atom(null, (get, set) => {
	const options = get(approvalOptionsAtom)
	if (options.length === 0) return

	const currentIndex = get(selectedIndexAtom)
	const nextIndex = (currentIndex + 1) % options.length
	set(selectedIndexAtom, nextIndex)
})

/**
 * Action atom to select the previous approval option
 */
export const selectPreviousApprovalAtom = atom(null, (get, set) => {
	const options = get(approvalOptionsAtom)
	if (options.length === 0) return

	const currentIndex = get(selectedIndexAtom)
	const prevIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1
	set(selectedIndexAtom, prevIndex)
})

/**
 * Derived atom to get the currently selected approval option
 */
export const selectedApprovalOptionAtom = atom<ApprovalOption | null>((get) => {
	const options = get(approvalOptionsAtom)
	const selectedIndex = get(selectedIndexAtom)

	return options[selectedIndex] ?? null
})

// ============================================================================
// Approval Action Callbacks (for keyboard handler)
// ============================================================================

/**
 * Atom to store the approve callback
 * The hook sets this to its approve function
 */
export const approveCallbackAtom = atom<(() => Promise<void>) | null>(null)

/**
 * Atom to store the reject callback
 * The hook sets this to its reject function
 */
export const rejectCallbackAtom = atom<(() => Promise<void>) | null>(null)

/**
 * Atom to store the executeSelected callback
 * The hook sets this to its executeSelected function
 */
export const executeSelectedCallbackAtom = atom<(() => Promise<void>) | null>(null)

/**
 * Action atom to approve the pending request
 * Calls the callback set by the hook
 */
export const approveAtom = atom(null, async (get, set) => {
	const callback = get(approveCallbackAtom)
	if (callback) {
		await callback()
	}
})

/**
 * Action atom to reject the pending request
 * Calls the callback set by the hook
 */
export const rejectAtom = atom(null, async (get, set) => {
	const callback = get(rejectCallbackAtom)
	if (callback) {
		await callback()
	}
})

/**
 * Action atom to execute the currently selected option
 * Calls the callback set by the hook
 */
export const executeSelectedAtom = atom(null, async (get, set) => {
	const callback = get(executeSelectedCallbackAtom)
	if (callback) {
		await callback()
	}
})
