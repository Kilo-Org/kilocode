/**
 * Centralized Approval Monitor Hook
 *
 * This hook monitors extension messages for ask messages and handles all approval orchestration.
 * It replaces the distributed useApprovalEffect that was previously called from multiple components.
 *
 * Similar to useFollowupHandler, this hook:
 * - Monitors messages from a single source (chatMessagesAtom via lastAskMessageAtom)
 * - Handles approval state management centrally
 * - Executes auto-approval logic when appropriate
 * - Cleans up when messages are answered
 *
 * @module useApprovalMonitor
 */

import { useCallback, useEffect, useRef } from "react"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import { lastAskMessageAtom, yoloModeAtom, addMessageAtom } from "../atoms/ui.js"
import { setPendingApprovalAtom, clearPendingApprovalAtom, approvalProcessingAtom } from "../atoms/approval.js"
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
import type { ExtensionChatMessage } from "../../types/messages.js"
import { logs } from "../../services/logs.js"
import { useApprovalTelemetry } from "./useApprovalTelemetry.js"
import { activeSlashCommandPolicyAtom } from "../atoms/slashCommands.js"
import { parseCommand } from "../../commands/core/parser.js"
import { getCustomSlashCommands, executeCustomSlashCommand } from "../../services/customSlashCommands.js"
import { checkAllowedTools } from "../../services/slashCommandTools.js"
import { useCommandContext } from "./useCommandContext.js"

/**
 * Hook that monitors messages and orchestrates approval flow
 *
 * This hook:
 * 1. Watches for new ask messages via lastAskMessageAtom
 * 2. Sets the message as pending approval when it arrives
 * 3. Gets the approval decision from the service
 * 4. Executes auto-approve/reject based on the decision
 * 5. Handles timeouts and cleanup
 * 6. Clears pending approval when message is answered
 *
 * @example
 * ```typescript
 * export const UI = () => {
 *   // Call once at the top level
 *   useApprovalMonitor()
 *
 *   return <Box>...</Box>
 * }
 * ```
 */
export function useApprovalMonitor(): void {
	const store = useStore()
	const lastAskMessage = useAtomValue(lastAskMessageAtom)
	const setPendingApproval = useSetAtom(setPendingApprovalAtom)
	const clearPendingApproval = useSetAtom(clearPendingApprovalAtom)
	const addMessage = useSetAtom(addMessageAtom)

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
	const isYoloMode = useAtomValue(yoloModeAtom)
	const slashCommandPolicy = useAtomValue(activeSlashCommandPolicyAtom)

	const { approve, reject } = useApprovalHandler()
	const { createContext } = useCommandContext()
	const approvalTelemetry = useApprovalTelemetry()

	// Track if we've already handled auto-approval for this message timestamp
	const autoApprovalHandledRef = useRef<Set<number>>(new Set())
	const runSlashCommandHandledRef = useRef<Set<number>>(new Set())

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

	const handleRunSlashCommand = useCallback(
		async (toolData: RunSlashCommandToolData, message: ExtensionChatMessage) => {
			const rawCommand = toolData.command || ""
			const commandName = rawCommand.replace(/^\//, "").trim().toLowerCase()

			if (!commandName) {
				await reject("runSlashCommand missing command name")
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: "runSlashCommand request missing a command name.",
					ts: Date.now(),
				})
				return
			}

			const policyDecision = checkAllowedTools(message, slashCommandPolicy)
			if (!policyDecision.allowed) {
				await reject(policyDecision.reason)
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: policyDecision.reason || `Slash command "/${commandName}" is not allowed.`,
					ts: Date.now(),
				})
				return
			}

			const commandDefinition = getCustomSlashCommands().find((cmd) => cmd.name === commandName)
			if (!commandDefinition) {
				await reject(`Unknown slash command "/${commandName}"`)
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `runSlashCommand could not find "/${commandName}".`,
					ts: Date.now(),
				})
				return
			}

			if (commandDefinition.metadata.disableModelInvocation) {
				await reject(`Slash command "/${commandName}" cannot be invoked by the model.`)
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Slash command "/${commandName}" is disabled for model invocation.`,
					ts: Date.now(),
				})
				return
			}

			const argString = toolData.args?.trim()
			const input = argString ? `/${commandName} ${argString}` : `/${commandName}`
			const parsed = parseCommand(input)
			const context = createContext(input, parsed?.args ?? [], parsed?.options ?? {}, () => {})

			await executeCustomSlashCommand(commandDefinition, context)
			await approve(`Executed /${commandName}`)
		},
		[addMessage, approve, reject, createContext, slashCommandPolicy],
	)

	// Track the last message we set as pending (full message snapshot for comparison)
	const lastPendingRef = useRef<{
		ts: number
		partial: boolean
		text: string
	} | null>(null)

	// Main effect: handle approval orchestration
	useEffect(() => {
		let timeoutId: NodeJS.Timeout | null = null

		// If no ask message, clear pending approval
		if (!lastAskMessage) {
			clearPendingApproval()
			lastPendingRef.current = null
			return
		}

		// If message is answered, clear pending approval
		if (lastAskMessage.isAnswered) {
			clearPendingApproval()
			lastPendingRef.current = null
			return
		}

		// Check if we're already processing this message
		const processingState = store.get(approvalProcessingAtom)
		if (processingState.isProcessing && processingState.processingTs === lastAskMessage.ts) {
			return
		}

		// Set as pending if:
		// 1. This is a new message (different timestamp), OR
		// 2. The message transitioned from partial to complete (need to update options), OR
		// 3. The message text changed (for command messages, this means the command is now available)
		const isNewMessage = !lastPendingRef.current || lastPendingRef.current.ts !== lastAskMessage.ts
		const transitionedToComplete =
			lastPendingRef.current &&
			lastPendingRef.current.ts === lastAskMessage.ts &&
			lastPendingRef.current.partial &&
			!lastAskMessage.partial
		const textChanged =
			lastPendingRef.current &&
			lastPendingRef.current.ts === lastAskMessage.ts &&
			lastPendingRef.current.text !== (lastAskMessage.text || "")

		if (isNewMessage || transitionedToComplete || textChanged) {
			lastPendingRef.current = {
				ts: lastAskMessage.ts,
				partial: lastAskMessage.partial || false,
				text: lastAskMessage.text || "",
			}
			setPendingApproval(lastAskMessage)
		}

		// Handle auto-approval once per message timestamp, but ONLY for complete messages
		// This allows the approval modal to show for partial messages while preventing premature auto-approval
		if (!lastAskMessage.partial && !autoApprovalHandledRef.current.has(lastAskMessage.ts)) {
			if (lastAskMessage.ask === "tool") {
				const toolData = parseToolData(lastAskMessage)
				if (toolData?.tool === "runSlashCommand") {
					if (!runSlashCommandHandledRef.current.has(lastAskMessage.ts)) {
						runSlashCommandHandledRef.current.add(lastAskMessage.ts)
						void handleRunSlashCommand(toolData, lastAskMessage).catch((error) => {
							logs.error("Failed to handle runSlashCommand tool request", "useApprovalMonitor", { error })
						})
					}
					return
				}
			}

			autoApprovalHandledRef.current.add(lastAskMessage.ts)

			// Get approval decision from service
			const decision = getApprovalDecision(lastAskMessage, config, isCIMode, isYoloMode, slashCommandPolicy)

			// Execute based on decision
			if (decision.action === "auto-approve") {
				const delay = decision.delay || 0

				if (delay > 0) {
					logs.info(`Auto-approving ${lastAskMessage.ask} after ${delay / 1000}s delay`, "useApprovalMonitor")
					timeoutId = setTimeout(() => {
						// Check if message is still the current ask before approving
						const currentAsk = store.get(lastAskMessageAtom)
						if (currentAsk?.ts === lastAskMessage.ts && !currentAsk.isAnswered) {
							approve(decision.message).catch((error) => {
								logs.error(`Failed to auto-approve ${lastAskMessage.ask}`, "useApprovalMonitor", {
									error,
								})
							})
						}
					}, delay)
				} else {
					logs.info(
						`${isCIMode ? "CI mode: " : ""}Auto-approving ${lastAskMessage.ask}`,
						"useApprovalMonitor",
					)
					// Track auto-approval
					approvalTelemetry.trackAutoApproval(lastAskMessage)
					// Execute approval immediately
					approve(decision.message).catch((error) => {
						logs.error(`Failed to auto-approve ${lastAskMessage.ask}`, "useApprovalMonitor", { error })
					})
				}
			} else if (decision.action === "auto-reject") {
				logs.info(`CI mode: Auto-rejecting ${lastAskMessage.ask}`, "useApprovalMonitor")
				// Track auto-rejection
				approvalTelemetry.trackAutoRejection(lastAskMessage)
				// Execute rejection immediately
				reject(decision.message).catch((error) => {
					logs.error(`CI mode: Failed to auto-reject ${lastAskMessage.ask}`, "useApprovalMonitor", { error })
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
		lastAskMessage,
		setPendingApproval,
		clearPendingApproval,
		approve,
		reject,
		addMessage,
		config,
		isCIMode,
		isYoloMode,
		slashCommandPolicy,
		createContext,
		handleRunSlashCommand,
		store,
		approvalTelemetry,
	])

	// Cleanup: remove old timestamps to prevent memory leak
	useEffect(() => {
		return () => {
			// Keep only the last 100 timestamps
			if (autoApprovalHandledRef.current.size > 100) {
				const timestamps = Array.from(autoApprovalHandledRef.current)
				const toKeep = timestamps.slice(-100)
				autoApprovalHandledRef.current = new Set(toKeep)
			}
			if (runSlashCommandHandledRef.current.size > 100) {
				const timestamps = Array.from(runSlashCommandHandledRef.current)
				const toKeep = timestamps.slice(-100)
				runSlashCommandHandledRef.current = new Set(toKeep)
			}
		}
	}, [lastAskMessage?.ts])
}

interface RunSlashCommandToolData {
	tool: string
	command?: string
	args?: string
	description?: string
}

function parseToolData(message: ExtensionChatMessage): RunSlashCommandToolData | null {
	if (!message.text) return null
	try {
		return JSON.parse(message.text) as RunSlashCommandToolData
	} catch {
		return null
	}
}
