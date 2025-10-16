import { atom } from "jotai"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { ciModeAtom } from "./ci.js"
import { logs } from "../../services/logs.js"
import {
	autoApproveReadAtom,
	autoApproveReadOutsideAtom,
	autoApproveWriteAtom,
	autoApproveWriteOutsideAtom,
	autoApproveWriteProtectedAtom,
	autoApproveBrowserAtom,
	autoApproveRetryAtom,
	autoApproveMcpAtom,
	autoApproveModeAtom,
	autoApproveSubtasksAtom,
	autoApproveExecuteAtom,
	autoApproveExecuteAllowedAtom,
	autoApproveExecuteDeniedAtom,
	autoApproveQuestionAtom,
	autoApproveTodoAtom,
} from "./config.js"

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
 * Atom to track the selected approval option index
 */
export const selectedApprovalIndexAtom = atom<number>(0)

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
	set(selectedApprovalIndexAtom, 0) // Reset selection
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
	set(selectedApprovalIndexAtom, 0)

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
	set(selectedApprovalIndexAtom, 0)
	set(approvalProcessingAtom, { isProcessing: false })
})

/**
 * Action atom to select the next approval option
 */
export const selectNextApprovalAtom = atom(null, (get, set) => {
	const options = get(approvalOptionsAtom)
	if (options.length === 0) return

	const currentIndex = get(selectedApprovalIndexAtom)
	const nextIndex = (currentIndex + 1) % options.length
	set(selectedApprovalIndexAtom, nextIndex)
})

/**
 * Action atom to select the previous approval option
 */
export const selectPreviousApprovalAtom = atom(null, (get, set) => {
	const options = get(approvalOptionsAtom)
	if (options.length === 0) return

	const currentIndex = get(selectedApprovalIndexAtom)
	const prevIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1
	set(selectedApprovalIndexAtom, prevIndex)
})

/**
 * Derived atom to get the currently selected approval option
 */
export const selectedApprovalOptionAtom = atom<ApprovalOption | null>((get) => {
	const options = get(approvalOptionsAtom)
	const selectedIndex = get(selectedApprovalIndexAtom)

	return options[selectedIndex] ?? null
})

/**
 * Helper function to check if a command matches allowed/denied patterns
 */
function matchesCommandPattern(command: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false

	return patterns.some((pattern) => {
		// Simple pattern matching - can be enhanced with regex if needed
		if (pattern === "*") return true
		if (pattern === command) return true
		// Check if command starts with pattern (for partial matches like "npm")
		if (command.startsWith(pattern)) return true
		return false
	})
}

/**
 * Derived atom to check if the current pending approval should be auto-approved
 * based on CLI configuration
 */
export const shouldAutoApproveAtom = atom<boolean>((get) => {
	const pendingMessage = get(pendingApprovalAtom)

	if (!pendingMessage || pendingMessage.type !== "ask") {
		return false
	}

	const askType = pendingMessage.ask

	try {
		switch (askType) {
			case "tool": {
				const toolData = JSON.parse(pendingMessage.text || "{}")
				const tool = toolData.tool

				// Read operations
				if (
					tool === "readFile" ||
					tool === "listFiles" ||
					tool === "listFilesTopLevel" ||
					tool === "listFilesRecursive" ||
					tool === "searchFiles" ||
					tool === "codebaseSearch" ||
					tool === "listCodeDefinitionNames"
				) {
					const isOutsideWorkspace = toolData.isOutsideWorkspace === true
					if (isOutsideWorkspace) {
						return get(autoApproveReadOutsideAtom)
					}
					return get(autoApproveReadAtom)
				}

				// Write operations
				if (
					tool === "editedExistingFile" ||
					tool === "appliedDiff" ||
					tool === "newFileCreated" ||
					tool === "insertContent" ||
					tool === "searchAndReplace"
				) {
					const isOutsideWorkspace = toolData.isOutsideWorkspace === true
					const isProtected = toolData.isProtected === true

					if (isProtected) {
						return get(autoApproveWriteProtectedAtom)
					}
					if (isOutsideWorkspace) {
						return get(autoApproveWriteOutsideAtom)
					}
					return get(autoApproveWriteAtom)
				}

				// Browser operations
				if (tool === "browser_action") {
					return get(autoApproveBrowserAtom)
				}

				// MCP operations
				if (tool === "use_mcp_tool" || tool === "access_mcp_resource") {
					return get(autoApproveMcpAtom)
				}

				// Mode switching
				if (tool === "switchMode") {
					return get(autoApproveModeAtom)
				}

				// Subtasks
				if (tool === "newTask") {
					return get(autoApproveSubtasksAtom)
				}

				// Todo list updates
				if (tool === "updateTodoList") {
					return get(autoApproveTodoAtom)
				}

				break
			}

			case "command": {
				const autoApproveExecute = get(autoApproveExecuteAtom)
				if (!autoApproveExecute) return false

				// Parse command from message - it's stored as JSON with a "command" field
				let command = ""
				try {
					const commandData = JSON.parse(pendingMessage.text || "{}")
					command = commandData.command || pendingMessage.text || ""
				} catch {
					// If parsing fails, use text directly
					command = pendingMessage.text || ""
				}

				const allowedCommands = get(autoApproveExecuteAllowedAtom)
				const deniedCommands = get(autoApproveExecuteDeniedAtom)

				// Check denied list first (takes precedence)
				if (matchesCommandPattern(command, deniedCommands)) {
					return false
				}

				// If allowed list is empty, don't allow any commands
				if (allowedCommands.length === 0) {
					return false
				}

				// Check if command matches allowed patterns
				return matchesCommandPattern(command, allowedCommands)
			}

			case "followup": {
				return get(autoApproveQuestionAtom)
			}

			case "api_req_failed": {
				return get(autoApproveRetryAtom)
			}

			default:
				return false
		}
	} catch {
		// If we can't parse the message, don't auto-approve
		return false
	}

	return false
})

/**
 * Derived atom to check if the current pending approval should be auto-rejected
 * in CI mode based on CLI configuration.
 *
 * This atom returns true when:
 * 1. CI mode is active
 * 2. The operation is NOT allowed by shouldAutoApproveAtom
 *
 * This is used to automatically reject operations in CI mode that don't meet
 * the auto-approval criteria.
 */
export const shouldAutoRejectAtom = atom<boolean>((get) => {
	const isCIMode = get(ciModeAtom)
	const shouldApprove = get(shouldAutoApproveAtom)

	// Only auto-reject in CI mode when the operation is not approved
	return isCIMode && !shouldApprove
})
