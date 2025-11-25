import { atom } from "jotai"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { logs } from "../../services/logs.js"
import { selectedIndexAtom } from "./ui.js"

/**
 * Approval option interface
 */
export interface ApprovalOption {
	label: string
	action: "approve" | "reject" | "approve-and-remember"
	hotkey: string
	color: "green" | "red"
	/** Command pattern to remember (for approve-and-remember action) */
	commandPattern?: string
	/** Unique key for React rendering (combines action + pattern) */
	key?: string
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
 * Atom to track when approval was set (for delay logic)
 */
export const approvalSetTimestampAtom = atom<number | null>(null)

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
 * Helper function to parse command into hierarchical parts
 * Example: "git status --short --branch" returns:
 * - "git"
 * - "git status"
 * - "git status --short --branch"
 */
function parseCommandHierarchy(command: string): string[] {
	const parts = command.trim().split(/\s+/).filter(Boolean)
	if (parts.length === 0) return []

	const hierarchy: string[] = []

	// Add base command
	if (parts[0]) {
		hierarchy.push(parts[0])
	}

	// Add command + first subcommand if exists
	if (parts.length > 1 && parts[0] && parts[1]) {
		hierarchy.push(`${parts[0]} ${parts[1]}`)
	}

	// Add full command if it's different from the previous entries
	if (parts.length > 2) {
		hierarchy.push(command)
	}

	return hierarchy
}

/**
 * Derived atom to get approval options based on the pending message type
 * Note: This atom recalculates whenever the pending message changes OR when
 * the message text/partial status changes (for streaming messages)
 */
export const approvalOptionsAtom = atom<ApprovalOption[]>((get) => {
	const pendingMessage = get(pendingApprovalAtom)

	if (!pendingMessage || pendingMessage.type !== "ask") {
		return []
	}

	// For command messages, wait until the message is complete (not partial)
	// and has text before generating hierarchical options
	if (pendingMessage.ask === "command" && (pendingMessage.partial || !pendingMessage.text)) {
		// Return basic options while waiting for complete message
		return [
			{
				label: "Run Command",
				action: "approve" as const,
				hotkey: "y",
				color: "green" as const,
			},
			{
				label: "Reject",
				action: "reject" as const,
				hotkey: "n",
				color: "red" as const,
			},
		]
	}

	// Determine button labels based on ask type
	let approveLabel = "Approve"
	let rejectLabel = "Reject"

	if (pendingMessage.ask === "command_output") {
		// Special handling for command output - Continue/Abort
		return [
			{
				label: "Continue",
				action: "approve" as const,
				hotkey: "y",
				color: "green" as const,
			},
			{
				label: "Abort",
				action: "reject" as const,
				hotkey: "n",
				color: "red" as const,
			},
		]
	} else if (pendingMessage.ask === "checkpoint_restore") {
		approveLabel = "Restore Checkpoint"
		rejectLabel = "Cancel"
	} else if (pendingMessage.ask === "tool") {
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

		// Parse command and generate hierarchical approval options
		let command = ""
		try {
			// Try parsing as JSON first
			const commandData = JSON.parse(pendingMessage.text || "{}")
			command = commandData.command || ""
		} catch {
			// If not JSON, use the text directly as the command
			command = pendingMessage.text || ""
		}

		if (command) {
			const hierarchy = parseCommandHierarchy(command)
			const options: ApprovalOption[] = [
				{
					label: approveLabel,
					action: "approve" as const,
					hotkey: "y",
					color: "green" as const,
				},
			]

			// Add "Always run X" options for each level of the hierarchy
			hierarchy.forEach((pattern, index) => {
				options.push({
					label: `Always Run "${pattern}"`,
					action: "approve-and-remember" as const,
					hotkey: String(index + 1),
					color: "green" as const,
					commandPattern: pattern,
					key: `approve-and-remember-${pattern}`,
				})
			})

			options.push({
				label: rejectLabel,
				action: "reject" as const,
				hotkey: "n",
				color: "red" as const,
			})

			return options
		}
	} else if (pendingMessage.ask === "payment_required_prompt") {
		approveLabel = "Retry"
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
		return
	}

	// Don't set if message is already answered
	if (message?.isAnswered) {
		return
	}
	// Get the current pending message to check if this is a new message or an update
	const current = get(pendingApprovalAtom)
	const isNewMessage = !current || current.ts !== message?.ts

	// Always create a new object reference to force Jotai to re-evaluate dependent atoms
	// This is critical for streaming messages that update from partial to complete
	// and ensures approvalOptionsAtom recalculates when message content changes
	const messageToSet = message ? { ...message } : null
	set(pendingApprovalAtom, messageToSet)

	// Set timestamp for delay tracking when setting a new message
	if (isNewMessage && messageToSet !== null) {
		set(approvalSetTimestampAtom, Date.now())
	}

	// Reset selection if this is a new message (different timestamp)
	// EXCEPT for command_output messages where we want to preserve selection
	// as output streams in (to allow users to abort long-running commands)
	const shouldResetSelection = isNewMessage && message?.ask !== "command_output"
	if (shouldResetSelection) {
		set(selectedIndexAtom, 0)
	}
})

/**
 * Action atom to clear the pending approval
 * This is an atomic operation that ensures proper cleanup
 */
export const clearPendingApprovalAtom = atom(null, (get, set) => {
	const current = get(pendingApprovalAtom)
	const processing = get(approvalProcessingAtom)

	set(pendingApprovalAtom, null)
	set(approvalSetTimestampAtom, null)

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
	set(pendingApprovalAtom, null)
	set(approvalSetTimestampAtom, null)
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
 * Atom to store the sendTerminalOperation callback
 * The hook sets this to its sendTerminalOperation function
 */
export const sendTerminalOperationCallbackAtom = atom<((operation: "continue" | "abort") => Promise<void>) | null>(null)

/**
 * Action atom to approve the pending request
 * Calls the callback set by the hook
 */
export const approveAtom = atom(null, async (get, _set) => {
	const callback = get(approveCallbackAtom)
	if (callback) {
		await callback()
	}
})

/**
 * Action atom to reject the pending request
 * Calls the callback set by the hook
 */
export const rejectAtom = atom(null, async (get, _set) => {
	const callback = get(rejectCallbackAtom)
	if (callback) {
		await callback()
	}
})

/**
 * Action atom to execute the currently selected option
 * Calls the callback set by the hook
 */
export const executeSelectedAtom = atom(null, async (get, _set) => {
	const callback = get(executeSelectedCallbackAtom)
	if (callback) {
		await callback()
	}
})

/**
 * Action atom to send terminal operation (continue or abort)
 * Calls the callback set by the hook
 */
export const sendTerminalOperationAtom = atom(null, async (get, _set, operation: "continue" | "abort") => {
	const callback = get(sendTerminalOperationCallbackAtom)
	if (callback) {
		await callback(operation)
	}
})
