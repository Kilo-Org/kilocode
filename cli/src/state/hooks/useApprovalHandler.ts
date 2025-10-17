import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useCallback } from "react"
import {
	pendingApprovalAtom,
	approvalOptionsAtom,
	selectedApprovalIndexAtom,
	selectedApprovalOptionAtom,
	selectNextApprovalAtom,
	selectPreviousApprovalAtom,
	isApprovalPendingAtom,
	startApprovalProcessingAtom,
	completeApprovalProcessingAtom,
	approvalProcessingAtom,
	type ApprovalOption,
} from "../atoms/approval.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { logs } from "../../services/logs.js"
import { useApprovalTelemetry } from "./useApprovalTelemetry.js"

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
	const isApprovalPending = useAtomValue(isApprovalPendingAtom)

	const selectNext = useSetAtom(selectNextApprovalAtom)
	const selectPrevious = useSetAtom(selectPreviousApprovalAtom)

	const { sendAskResponse } = useWebviewMessage()
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

				await sendAskResponse({
					response: "yesButtonClicked",
					...(text && { text }),
					...(images && { images }),
				})

				logs.debug("Approval response sent successfully", "useApprovalHandler", {
					ts: currentPendingApproval.ts,
				})

				// Track manual approval
				approvalTelemetry.trackManualApproval(currentPendingApproval)

				// Complete processing atomically - this clears both pending and processing state
				store.set(completeApprovalProcessingAtom)
			} catch (error) {
				logs.error("Failed to approve request", "useApprovalHandler", { error })
				// Reset processing state on error so user can retry
				store.set(completeApprovalProcessingAtom)
				throw error
			}
		},
		[store, sendAskResponse, approvalTelemetry],
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

				await sendAskResponse({
					response: "noButtonClicked",
					...(text && { text }),
					...(images && { images }),
				})

				logs.debug("Rejection response sent successfully", "useApprovalHandler")

				// Track manual rejection
				approvalTelemetry.trackManualRejection(currentPendingApproval)

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

	const executeSelected = useCallback(
		async (text?: string, images?: string[]) => {
			if (!selectedOption) {
				logs.warn("No option selected", "useApprovalHandler")
				return
			}

			if (selectedOption.action === "approve") {
				await approve(text, images)
			} else {
				await reject(text, images)
			}
		},
		[selectedOption, approve, reject],
	)

	// Note: All auto-approval logic has been moved to useApprovalEffect hook
	// and the approvalDecision service. This hook now only handles manual
	// approve/reject actions triggered by user interaction.

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
	}
}
