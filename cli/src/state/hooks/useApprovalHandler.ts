import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useCallback, useEffect, useState } from "react"
import {
	pendingApprovalAtom,
	approvalOptionsAtom,
	selectedApprovalIndexAtom,
	selectedApprovalOptionAtom,
	selectNextApprovalAtom,
	selectPreviousApprovalAtom,
	isApprovalPendingAtom,
	approvalSetTimestampAtom,
	startApprovalProcessingAtom,
	completeApprovalProcessingAtom,
	approvalProcessingAtom,
	approveCallbackAtom,
	rejectCallbackAtom,
	executeSelectedCallbackAtom,
	sendTerminalOperationCallbackAtom,
	type ApprovalOption,
} from "../atoms/approval.js"
import { addAllowedCommandAtom, autoApproveExecuteAllowedAtom } from "../atoms/config.js"
import { updateChatMessageByTsAtom } from "../atoms/extension.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { logs } from "../../services/logs.js"
import { useApprovalTelemetry } from "./useApprovalTelemetry.js"

const APPROVAL_MENU_DELAY_MS = 500

// command_output asks should show immediately without delay
// since they represent running commands that users need to be able to abort
const COMMAND_OUTPUT_DELAY_MS = 0

/**
 * Options for useApprovalHandler hook
 */
export interface UseApprovalHandlerOptions {
	/** Whether CI mode is active (for testing/override purposes) */
	ciMode?: boolean
}

/**
 * Return type for useApprovalHandler hook
 */
export interface UseApprovalHandlerReturn {
	/** The message currently awaiting approval */
	pendingApproval: ExtensionChatMessage | null
	/** Available approval options */
	approvalOptions: ApprovalOption[]
	/** Currently selected option index */
	selectedIndex: number
	/** Currently selected option */
	selectedOption: ApprovalOption | null
	/** Whether approval is pending */
	isApprovalPending: boolean
	/** Select the next option */
	selectNext: () => void
	/** Select the previous option */
	selectPrevious: () => void
	/** Approve the pending request */
	approve: (text?: string, images?: string[]) => Promise<void>
	/** Reject the pending request */
	reject: (text?: string, images?: string[]) => Promise<void>
	/** Execute the currently selected option */
	executeSelected: (text?: string, images?: string[]) => Promise<void>
	/** Send terminal operation (continue or abort) */
	sendTerminalOperation: (operation: "continue" | "abort") => Promise<void>
}

/**
 * Hook that provides approval/rejection functionality
 *
 * This hook manages the approval flow for ask messages, providing methods
 * to approve, reject, and navigate between options.
 *
 * In CI mode, this hook automatically approves or rejects requests based on
 * configuration settings without user interaction.
 *
 * @example
 * ```tsx
 * function ApprovalUI() {
 *   const { pendingApproval, approve, reject, isApprovalPending } = useApprovalHandler()
 *
 *   if (!isApprovalPending) return null
 *
 *   return (
 *     <div>
 *       <button onClick={() => approve()}>Approve</button>
 *       <button onClick={() => reject()}>Reject</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useApprovalHandler(): UseApprovalHandlerReturn {
	const store = useStore()
	const pendingApproval = useAtomValue(pendingApprovalAtom)
	const approvalOptions = useAtomValue(approvalOptionsAtom)
	const selectedIndex = useAtomValue(selectedApprovalIndexAtom)
	const selectedOption = useAtomValue(selectedApprovalOptionAtom)
	const approvalSetTimestamp = useAtomValue(approvalSetTimestampAtom)
	const isApprovalPendingImmediate = useAtomValue(isApprovalPendingAtom)

	// Use state to manage delayed visibility
	const [showApprovalMenu, setShowApprovalMenu] = useState(false)

	// Compute if approval is pending with delay
	const isApprovalPending = isApprovalPendingImmediate && showApprovalMenu

	const selectNext = useSetAtom(selectNextApprovalAtom)
	const selectPrevious = useSetAtom(selectPreviousApprovalAtom)

	const setApproveCallback = useSetAtom(approveCallbackAtom)
	const setRejectCallback = useSetAtom(rejectCallbackAtom)
	const setExecuteSelectedCallback = useSetAtom(executeSelectedCallbackAtom)
	const setSendTerminalOperationCallback = useSetAtom(sendTerminalOperationCallbackAtom)

	const { sendAskResponse, sendMessage } = useWebviewMessage()
	const approvalTelemetry = useApprovalTelemetry()

	const approve = useCallback(
		async (text?: string, images?: string[]) => {
			// Read the current state directly from the store at call time
			// This ensures we get the latest value, not a stale closure value
			const currentPendingApproval = store.get(pendingApprovalAtom)
			const processingState = store.get(approvalProcessingAtom)

			if (!currentPendingApproval) {
				logs.warn("No pending approval to approve", "useApprovalHandler", {
					storeValue: currentPendingApproval,
				})
				return
			}

			// Check if already processing
			if (processingState.isProcessing) {
				logs.warn("Approval already being processed, skipping duplicate", "useApprovalHandler", {
					processingTs: processingState.processingTs,
					currentTs: currentPendingApproval.ts,
				})
				return
			}

			// Start processing atomically - this prevents duplicate attempts
			const started = store.set(startApprovalProcessingAtom, "approve")
			if (!started) {
				logs.warn("Failed to start approval processing", "useApprovalHandler")
				return
			}

			try {
				logs.debug("Approving request", "useApprovalHandler", {
					ask: currentPendingApproval.ask,
					ts: currentPendingApproval.ts,
				})

				// Mark message as answered locally BEFORE sending response
				// This prevents lastAskMessageAtom from returning it again
				const answeredMessage: ExtensionChatMessage = {
					...currentPendingApproval,
					isAnswered: true,
				}
				store.set(updateChatMessageByTsAtom, answeredMessage)

				// Handle checkpoint restore separately - send direct webview message instead of ask response
				if (currentPendingApproval.ask === "checkpoint_restore") {
					try {
						// Parse checkpoint data from the message text
						const checkpointData = JSON.parse(currentPendingApproval.text || "{}")
						const { commitHash, checkpointTs } = checkpointData

						logs.debug("Sending checkpoint restore message", "useApprovalHandler", {
							commitHash,
							checkpointTs,
						})

						// Send direct webview message to trigger restore
						await sendMessage({
							type: "checkpointRestore",
							payload: {
								ts: checkpointTs,
								commitHash: commitHash,
								mode: "restore",
							},
						})

						logs.debug("Checkpoint restore message sent successfully", "useApprovalHandler", {
							ts: currentPendingApproval.ts,
						})
					} catch (error) {
						logs.error("Failed to parse checkpoint data or send restore message", "useApprovalHandler", {
							error,
						})
						throw error
					}
				} else {
					// Determine response type based on ask type
					// payment_required_prompt needs special "retry_clicked" response
					const responseType =
						currentPendingApproval.ask === "payment_required_prompt" ? "retry_clicked" : "yesButtonClicked"

					await sendAskResponse({
						response: responseType,
						...(text && { text }),
						...(images && { images }),
					})

					logs.debug("Approval response sent successfully", "useApprovalHandler", {
						ts: currentPendingApproval.ts,
						responseType,
					})

					// Track manual approval
					approvalTelemetry.trackManualApproval(currentPendingApproval)
				}

				// Complete processing atomically - this clears both pending and processing state
				store.set(completeApprovalProcessingAtom)
			} catch (error) {
				logs.error("Failed to approve request", "useApprovalHandler", { error })
				// Reset processing state on error so user can retry
				store.set(completeApprovalProcessingAtom)
				throw error
			}
		},
		[store, sendAskResponse, sendMessage, approvalTelemetry],
	)

	const reject = useCallback(
		async (text?: string, images?: string[]) => {
			// Read the current state directly from the store at call time
			const currentPendingApproval = store.get(pendingApprovalAtom)
			const processingState = store.get(approvalProcessingAtom)

			if (!currentPendingApproval) {
				logs.warn("No pending approval to reject", "useApprovalHandler", {
					storeValue: currentPendingApproval,
				})
				return
			}

			// Check if already processing
			if (processingState.isProcessing) {
				logs.warn("Approval already being processed, skipping duplicate", "useApprovalHandler", {
					processingTs: processingState.processingTs,
					currentTs: currentPendingApproval.ts,
				})
				return
			}

			// Start processing atomically - this prevents duplicate attempts
			const started = store.set(startApprovalProcessingAtom, "reject")
			if (!started) {
				logs.warn("Failed to start rejection processing", "useApprovalHandler")
				return
			}

			try {
				logs.debug("Rejecting request", "useApprovalHandler", { ask: currentPendingApproval.ask })

				// Mark message as answered locally BEFORE sending response
				// This prevents lastAskMessageAtom from returning it again
				const answeredMessage: ExtensionChatMessage = {
					...currentPendingApproval,
					isAnswered: true,
				}
				store.set(updateChatMessageByTsAtom, answeredMessage)

				// For checkpoint_restore, we don't need to send any message on cancel - just mark as answered
				if (currentPendingApproval.ask !== "checkpoint_restore") {
					await sendAskResponse({
						response: "noButtonClicked",
						...(text && { text }),
						...(images && { images }),
					})

					logs.debug("Rejection response sent successfully", "useApprovalHandler")

					// Track manual rejection
					approvalTelemetry.trackManualRejection(currentPendingApproval)
				}

				// Complete processing atomically - this clears both pending and processing state
				store.set(completeApprovalProcessingAtom)
			} catch (error) {
				logs.error("Failed to reject request", "useApprovalHandler", { error })
				// Reset processing state on error so user can retry
				store.set(completeApprovalProcessingAtom)
				throw error
			}
		},
		[store, sendAskResponse, approvalTelemetry],
	)

	const sendTerminalOperation = useCallback(
		async (operation: "continue" | "abort") => {
			// Read the current state directly from the store at call time
			const currentPendingApproval = store.get(pendingApprovalAtom)
			const processingState = store.get(approvalProcessingAtom)

			if (!currentPendingApproval) {
				logs.warn("No pending approval for terminal operation", "useApprovalHandler", {
					operation,
				})
				return
			}

			// Verify this is a command_output ask
			if (currentPendingApproval.ask !== "command_output") {
				logs.warn("Terminal operation called for non-command_output ask", "useApprovalHandler", {
					ask: currentPendingApproval.ask,
					operation,
				})
				return
			}

			// Check if already processing
			if (processingState.isProcessing) {
				logs.warn("Approval already being processed, skipping duplicate", "useApprovalHandler", {
					processingTs: processingState.processingTs,
					currentTs: currentPendingApproval.ts,
				})
				return
			}

			// Start processing atomically
			const started = store.set(startApprovalProcessingAtom, operation === "continue" ? "approve" : "reject")
			if (!started) {
				logs.warn("Failed to start terminal operation processing", "useApprovalHandler")
				return
			}

			try {
				logs.debug(`Sending terminal operation: ${operation}`, "useApprovalHandler", {
					ts: currentPendingApproval.ts,
				})

				// Mark message as answered locally BEFORE sending operation
				const answeredMessage: ExtensionChatMessage = {
					...currentPendingApproval,
					isAnswered: true,
				}
				store.set(updateChatMessageByTsAtom, answeredMessage)

				// For terminal operations, we only need to send the terminal operation message
				// DO NOT send askResponse - that would resolve the wrong ask (completion_result instead of command_output)
				// The backend's onLine callback handles the command_output ask internally
				await sendMessage({
					type: "terminalOperation",
					terminalOperation: operation,
				})

				logs.debug("Terminal operation sent successfully", "useApprovalHandler", {
					operation,
					ts: currentPendingApproval.ts,
				})

				// Track the operation as manual approval/rejection
				if (operation === "continue") {
					approvalTelemetry.trackManualApproval(currentPendingApproval)
				} else {
					approvalTelemetry.trackManualRejection(currentPendingApproval)
				}

				// Complete processing atomically
				store.set(completeApprovalProcessingAtom)
			} catch (error) {
				logs.error("Failed to send terminal operation", "useApprovalHandler", { error, operation })
				// Reset processing state on error so user can retry
				store.set(completeApprovalProcessingAtom)
				throw error
			}
		},
		[store, sendMessage, sendAskResponse, approvalTelemetry],
	)

	const executeSelected = useCallback(
		async (text?: string, images?: string[]) => {
			// Read the current state to check if this is a command_output
			const currentPendingApproval = store.get(pendingApprovalAtom)

			if (!selectedOption) {
				logs.warn("No option selected", "useApprovalHandler")
				return
			}

			// Special handling for command_output - use terminal operations instead
			if (currentPendingApproval?.ask === "command_output") {
				if (selectedOption.action === "approve") {
					await sendTerminalOperation("continue")
				} else {
					await sendTerminalOperation("abort")
				}
				return
			}

			if (selectedOption.action === "approve") {
				await approve(text, images)
			} else if (selectedOption.action === "approve-and-remember") {
				// First add the command pattern to config
				if (selectedOption.commandPattern) {
					try {
						logs.info("Adding command pattern to auto-approval list", "useApprovalHandler", {
							pattern: selectedOption.commandPattern,
						})
						await store.set(addAllowedCommandAtom, selectedOption.commandPattern)

						// Verify the config was updated
						const updatedAllowed = store.get(autoApproveExecuteAllowedAtom)
						logs.info("Command pattern added successfully - current allowed list", "useApprovalHandler", {
							pattern: selectedOption.commandPattern,
							allowedList: updatedAllowed,
						})
					} catch (error) {
						logs.error("Failed to add command pattern to config", "useApprovalHandler", { error })
					}
				}
				// Then approve the current command
				await approve(text, images)
			} else {
				await reject(text, images)
			}
		},
		[selectedOption, approve, reject, sendTerminalOperation, store],
	)

	// Set callbacks for keyboard handler to use
	useEffect(() => {
		setApproveCallback(() => approve)
		setRejectCallback(() => reject)
		setExecuteSelectedCallback(() => executeSelected)
		setSendTerminalOperationCallback(() => sendTerminalOperation)
	}, [
		approve,
		reject,
		executeSelected,
		sendTerminalOperation,
		setApproveCallback,
		setRejectCallback,
		setExecuteSelectedCallback,
		setSendTerminalOperationCallback,
	])

	// Manage delayed visibility of approval menu
	useEffect(() => {
		if (approvalSetTimestamp === null) {
			// No pending approval, hide menu
			setShowApprovalMenu(false)
			return
		}

		// Determine delay based on ask type
		// command_output asks should show immediately so users can abort running commands
		const delay = pendingApproval?.ask === "command_output" ? COMMAND_OUTPUT_DELAY_MS : APPROVAL_MENU_DELAY_MS

		// Calculate remaining time for delay
		const elapsed = Date.now() - approvalSetTimestamp
		const remaining = Math.max(0, delay - elapsed)

		// Set timeout to show menu after delay
		const timeoutId = setTimeout(() => {
			setShowApprovalMenu(true)
		}, remaining)

		return () => {
			clearTimeout(timeoutId)
		}
	}, [approvalSetTimestamp, isApprovalPendingImmediate, pendingApproval?.ask])

	return {
		pendingApproval,
		approvalOptions,
		selectedIndex,
		selectedOption,
		isApprovalPending,
		selectNext,
		selectPrevious,
		approve,
		reject,
		executeSelected,
		sendTerminalOperation,
	}
}
