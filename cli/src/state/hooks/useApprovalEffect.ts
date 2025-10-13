/**
 * Centralized Approval Effect Hook
 *
 * This hook handles all approval orchestration for Ask messages.
 * It replaces the duplicated approval logic that was previously
 * scattered across multiple Ask message components.
 *
 * RACE CONDITION FIXES:
 * - Uses atomic state operations to prevent duplicate approvals
 * - Single source of truth for approval processing
 * - Proper cleanup when messages are answered
 * - No stale closures - reads state from store at execution time
 * - Prevents re-processing same message on re-renders
 *
 * @module useApprovalEffect
 */

import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import type { ExtensionChatMessage } from "../../types/messages.js"
import {
	setPendingApprovalAtom,
	clearPendingApprovalAtom,
	approvalProcessingAtom,
	pendingApprovalAtom,
} from "../atoms/approval.js"
import {
	autoApproveReadAtom,
	autoApproveReadOutsideAtom,
	autoApproveWriteAtom,
	autoApproveWriteOutsideAtom,
	autoApproveWriteProtectedAtom,
	autoApproveBrowserAtom,
	autoApproveRetryAtom,
	autoApproveRetryDelayAtom,
	autoApproveMcpAtom,
	autoApproveModeAtom,
	autoApproveSubtasksAtom,
	autoApproveExecuteAtom,
	autoApproveExecuteAllowedAtom,
	autoApproveExecuteDeniedAtom,
	autoApproveQuestionAtom,
	autoApproveQuestionTimeoutAtom,
	autoApproveTodoAtom,
} from "../atoms/config.js"
import { ciModeAtom } from "../atoms/ci.js"
import { useApprovalHandler } from "./useApprovalHandler.js"
import { getApprovalDecision } from "../../services/approvalDecision.js"
import type { AutoApprovalConfig } from "../../config/types.js"
import { logs } from "../../services/logs.js"
import { useApprovalTelemetry } from "./useApprovalTelemetry.js"

/**
 * Hook that orchestrates approval flow for Ask messages
 *
 * This hook:
 * 1. Sets the message as pending approval when it arrives
 * 2. Gets the approval decision from the service
 * 3. Executes auto-approve/reject based on the decision
 * 4. Handles timeouts and cleanup
 * 5. Clears pending approval when message is answered
 *
 * IMPORTANT: This is the ONLY place where auto-approval should be triggered.
 * Other components should only set pending approval, not execute approvals.
 *
 * @param message - The Ask message to handle
 *
 * @example
 * ```typescript
 * export const AskCommandMessage = ({ message }) => {
 *   useApprovalEffect(message)
 *
 *   // Just render UI
 *   return <Box>...</Box>
 * }
 * ```
 */
export function useApprovalEffect(message: ExtensionChatMessage): void {
	const store = useStore()
	const setPendingApproval = useSetAtom(setPendingApprovalAtom)
	const clearPendingApproval = useSetAtom(clearPendingApprovalAtom)

	// Get all config values
	const autoApproveRead = useAtomValue(autoApproveReadAtom)
	const autoApproveReadOutside = useAtomValue(autoApproveReadOutsideAtom)
	const autoApproveWrite = useAtomValue(autoApproveWriteAtom)
	const autoApproveWriteOutside = useAtomValue(autoApproveWriteOutsideAtom)
	const autoApproveWriteProtected = useAtomValue(autoApproveWriteProtectedAtom)
	const autoApproveBrowser = useAtomValue(autoApproveBrowserAtom)
	const autoApproveRetry = useAtomValue(autoApproveRetryAtom)
	const autoApproveRetryDelay = useAtomValue(autoApproveRetryDelayAtom)
	const autoApproveMcp = useAtomValue(autoApproveMcpAtom)
	const autoApproveMode = useAtomValue(autoApproveModeAtom)
	const autoApproveSubtasks = useAtomValue(autoApproveSubtasksAtom)
	const autoApproveExecute = useAtomValue(autoApproveExecuteAtom)
	const autoApproveExecuteAllowed = useAtomValue(autoApproveExecuteAllowedAtom)
	const autoApproveExecuteDenied = useAtomValue(autoApproveExecuteDeniedAtom)
	const autoApproveQuestion = useAtomValue(autoApproveQuestionAtom)
	const autoApproveQuestionTimeout = useAtomValue(autoApproveQuestionTimeoutAtom)
	const autoApproveTodo = useAtomValue(autoApproveTodoAtom)
	const isCIMode = useAtomValue(ciModeAtom)

	const { approve, reject } = useApprovalHandler()
	const approvalTelemetry = useApprovalTelemetry()

	// Track if we've already handled auto-approval for this message timestamp
	const autoApprovalHandledRef = useRef<Set<number>>(new Set())
	// Track the last message timestamp we processed to prevent re-processing on re-renders
	const lastProcessedTsRef = useRef<number | null>(null)

	// Build config object with proper nested structure
	const config: AutoApprovalConfig = {
		read: {
			enabled: autoApproveRead,
			outside: autoApproveReadOutside,
		},
		write: {
			enabled: autoApproveWrite,
			outside: autoApproveWriteOutside,
			protected: autoApproveWriteProtected,
		},
		browser: {
			enabled: autoApproveBrowser,
		},
		retry: {
			enabled: autoApproveRetry,
			delay: autoApproveRetryDelay,
		},
		mcp: {
			enabled: autoApproveMcp,
		},
		mode: {
			enabled: autoApproveMode,
		},
		subtasks: {
			enabled: autoApproveSubtasks,
		},
		todo: {
			enabled: autoApproveTodo,
		},
		execute: {
			enabled: autoApproveExecute,
			allowed: autoApproveExecuteAllowed,
			denied: autoApproveExecuteDenied,
		},
		question: {
			enabled: autoApproveQuestion,
			timeout: autoApproveQuestionTimeout,
		},
	}

	// Main effect: handle approval orchestration
	useEffect(() => {
		let timeoutId: NodeJS.Timeout | null = null

		// If message is answered, clear pending approval and don't process
		if (message.isAnswered) {
			clearPendingApproval()
			return
		}

		// Skip if this is a partial message
		if (message.partial) {
			return
		}

		// CRITICAL FIX: Skip if we've already processed this exact message timestamp
		// This prevents re-processing on re-renders when the message object reference changes
		if (lastProcessedTsRef.current === message.ts) {
			return
		}

		// Check if we're already processing this message
		const processingState = store.get(approvalProcessingAtom)
		if (processingState.isProcessing && processingState.processingTs === message.ts) {
			return
		}

		// Check if this message is already pending
		const currentPending = store.get(pendingApprovalAtom)
		if (currentPending?.ts === message.ts) {
			// Don't set pending again, but continue with auto-approval check
		} else {
			// Set pending approval (this will be skipped if already processing)
			setPendingApproval(message)
		}

		// Mark this timestamp as processed
		lastProcessedTsRef.current = message.ts

		// Handle auto-approval once per message timestamp
		if (!autoApprovalHandledRef.current.has(message.ts)) {
			autoApprovalHandledRef.current.add(message.ts)

			// Get approval decision from service
			const decision = getApprovalDecision(message, config, isCIMode)

			// Execute based on decision
			if (decision.action === "auto-approve") {
				const delay = decision.delay || 0

				if (delay > 0) {
					logs.info(`Auto-approving ${message.ask} after ${delay / 1000}s delay`, "useApprovalEffect")
					timeoutId = setTimeout(() => {
						// Check if message is still pending before approving
						const currentPending = store.get(pendingApprovalAtom)
						if (currentPending?.ts === message.ts && !currentPending.isAnswered) {
							approve(decision.message).catch((error) => {
								logs.error(`Failed to auto-approve ${message.ask}`, "useApprovalEffect", { error })
							})
						}
					}, delay)
				} else {
					logs.info(`${isCIMode ? "CI mode: " : ""}Auto-approving ${message.ask}`, "useApprovalEffect")
					// Track auto-approval
					approvalTelemetry.trackAutoApproval(message)
					// Execute approval immediately
					approve(decision.message).catch((error) => {
						logs.error(`Failed to auto-approve ${message.ask}`, "useApprovalEffect", { error })
					})
				}
			} else if (decision.action === "auto-reject") {
				logs.info(`CI mode: Auto-rejecting ${message.ask}`, "useApprovalEffect")
				// Track auto-rejection
				approvalTelemetry.trackAutoRejection(message)
				// Execute rejection immediately
				reject(decision.message).catch((error) => {
					logs.error(`CI mode: Failed to auto-reject ${message.ask}`, "useApprovalEffect", { error })
				})
			}
		}

		// Cleanup function - only clear timeout
		return () => {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
		}
	}, [
		message.ts,
		message.isAnswered,
		message.partial,
		message.ask,
		setPendingApproval,
		clearPendingApproval,
		approve,
		reject,
		config,
		isCIMode,
		store,
	])

	// Cleanup: remove timestamp from handled set when message timestamp changes
	useEffect(() => {
		return () => {
			// Clean up old timestamps to prevent memory leak
			// Keep only the last 100 timestamps
			if (autoApprovalHandledRef.current.size > 100) {
				const timestamps = Array.from(autoApprovalHandledRef.current)
				const toKeep = timestamps.slice(-100)
				autoApprovalHandledRef.current = new Set(toKeep)
			}
		}
	}, [message.ts])
}
