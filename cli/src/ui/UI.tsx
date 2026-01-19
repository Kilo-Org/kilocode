/**
 * CommandUI - Main application component for command-based UI
 * Refactored to use specialized hooks for better maintainability
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { Box, Text } from "ink"
import { useAtomValue, useSetAtom } from "jotai"
import { isStreamingAtom, errorAtom, addMessageAtom, messageResetCounterAtom, yoloModeAtom } from "../state/atoms/ui.js"
import { processImagePaths } from "../media/images.js"
import { setCIModeAtom, ciCompletionDetectedAtom, ciCompletionIgnoreBeforeTimestampAtom } from "../state/atoms/ci.js"
import { configValidationAtom } from "../state/atoms/config.js"
import { lastChatMessageAtom, taskResumedViaContinueOrSessionAtom } from "../state/atoms/extension.js"
import { useTaskState } from "../state/hooks/useTaskState.js"
import { isParallelModeAtom } from "../state/atoms/index.js"
import { addToHistoryAtom, resetHistoryNavigationAtom, exitHistoryModeAtom } from "../state/atoms/history.js"
import { MessageDisplay } from "./messages/MessageDisplay.js"
import { JsonRenderer } from "./JsonRenderer.js"
import { CommandInput } from "./components/CommandInput.js"
import { StatusBar } from "./components/StatusBar.js"
import { StatusIndicator } from "./components/StatusIndicator.js"
import { initializeCommands } from "../commands/index.js"
import { initializeCustomCommands } from "../commands/custom.js"
import { isCommandInput } from "../services/autocomplete.js"
import { useCommandHandler } from "../state/hooks/useCommandHandler.js"
import { useMessageHandler } from "../state/hooks/useMessageHandler.js"
import { useFollowupHandler } from "../state/hooks/useFollowupHandler.js"
import { useApprovalMonitor } from "../state/hooks/useApprovalMonitor.js"
import { useProfile } from "../state/hooks/useProfile.js"
import { useTaskHistory } from "../state/hooks/useTaskHistory.js"
import { useCIMode } from "../state/hooks/useCIMode.js"
import { useTheme } from "../state/hooks/useTheme.js"
import { AppOptions } from "./App.js"
import { logs } from "../services/logs.js"
import { createConfigErrorInstructions, createWelcomeMessage } from "./utils/welcomeMessage.js"
import { generateUpdateAvailableMessage, getAutoUpdateStatus } from "../utils/auto-update.js"
import { generateNotificationMessage } from "../utils/notifications.js"
import { notificationsAtom } from "../state/atoms/notifications.js"
import { workspacePathAtom } from "../state/atoms/shell.js"
import { useTerminal } from "../state/hooks/useTerminal.js"
import { exitRequestCounterAtom } from "../state/atoms/keyboard.js"
import { useWebviewMessage } from "../state/hooks/useWebviewMessage.js"
import { isResumeAskMessage, shouldWaitForResumeAsk } from "./utils/resumePrompt.js"

// Initialize built-in commands on module load
initializeCommands()

interface UIAppProps {
	options: AppOptions
	onExit: () => void
}

export const UI: React.FC<UIAppProps> = ({ options, onExit }) => {
	const isStreaming = useAtomValue(isStreamingAtom)
	const error = useAtomValue(errorAtom)
	const theme = useTheme()
	const configValidation = useAtomValue(configValidationAtom)
	const resetCounter = useAtomValue(messageResetCounterAtom)
	const notifications = useAtomValue(notificationsAtom)
	const [versionStatus, setVersionStatus] = useState<Awaited<ReturnType<typeof getAutoUpdateStatus>>>()

	// Initialize CI mode and YOLO mode configuration
	const setCIMode = useSetAtom(setCIModeAtom)
	const setYoloMode = useSetAtom(yoloModeAtom)
	const addMessage = useSetAtom(addMessageAtom)
	const setTaskResumedViaSession = useSetAtom(taskResumedViaContinueOrSessionAtom)
	const setCiCompletionDetected = useSetAtom(ciCompletionDetectedAtom)
	const setCiCompletionIgnoreBeforeTimestamp = useSetAtom(ciCompletionIgnoreBeforeTimestampAtom)
	const addToHistory = useSetAtom(addToHistoryAtom)
	const resetHistoryNavigation = useSetAtom(resetHistoryNavigationAtom)
	const exitHistoryMode = useSetAtom(exitHistoryModeAtom)
	const setIsParallelMode = useSetAtom(isParallelModeAtom)
	const setWorkspacePath = useSetAtom(workspacePathAtom)
	const taskResumedViaSession = useAtomValue(taskResumedViaContinueOrSessionAtom)
	const lastChatMessage = useAtomValue(lastChatMessageAtom)
	const { hasActiveTask } = useTaskState()
	const exitRequestCounter = useAtomValue(exitRequestCounterAtom)

	// Use specialized hooks for command and message handling
	const { executeCommand, isExecuting: isExecutingCommand } = useCommandHandler()
	const { sendUserMessage, isSending: isSendingMessage } = useMessageHandler({
		...(options.ci !== undefined && { ciMode: options.ci }),
	})

	// Get sendMessage for sending initial prompt with attachments
	const { sendMessage, sendAskResponse } = useWebviewMessage()

	// Followup handler hook for automatic suggestion population
	useFollowupHandler()

	// Approval monitor hook for centralized approval handling
	useApprovalMonitor()

	// Profile hook for handling profile/balance data responses
	useProfile()

	// Task history hook for fetching task history
	const { fetchTaskHistory } = useTaskHistory()

	// This clears the terminal and forces re-render of static components
	useTerminal()

	// CI mode hook for automatic exit
	const { shouldExit, exitReason } = useCIMode({
		enabled: options.ci || false,
		...(options.timeout !== undefined && { timeout: options.timeout }),
		onExit: onExit,
	})

	const handledExitRequestRef = useRef(exitRequestCounter)

	useEffect(() => {
		if (exitRequestCounter === handledExitRequestRef.current) {
			return
		}

		handledExitRequestRef.current = exitRequestCounter
		void executeCommand("/exit", onExit)
	}, [exitRequestCounter, executeCommand, onExit])

	// Track if prompt has been executed and welcome message shown
	const promptExecutedRef = useRef(false)
	const welcomeShownRef = useRef(false)
	const autoUpdatedCheckedRef = useRef(false)

	// Initialize CI mode atoms
	useEffect(() => {
		if (options.ci) {
			logs.info("Initializing CI mode", "UI", { timeout: options.timeout })
			setCIMode({
				enabled: true,
				...(options.timeout !== undefined && { timeout: options.timeout }),
			})
		}
	}, [options.ci, options.timeout, setCIMode])

	// Initialize YOLO mode atom
	useEffect(() => {
		if (options.yolo) {
			logs.info("Initializing YOLO mode", "UI")
			setYoloMode(true)
		}
	}, [options.yolo, setYoloMode])

	// Set parallel mode flag
	useEffect(() => {
		if (options.parallel) {
			setIsParallelMode(true)
		}
	}, [options.parallel, setIsParallelMode])

	// Initialize workspace path for shell commands and load custom commands
	useEffect(() => {
		const workspace = options.workspace || process.cwd()
		if (options.workspace) {
			setWorkspacePath(options.workspace)
		}
		// Load custom commands from ~/.kilocode/commands/ and .kilocode/commands/
		void initializeCustomCommands(workspace)
	}, [options.workspace, setWorkspacePath])

	// Handle CI mode exit
	useEffect(() => {
		if (shouldExit && options.ci) {
			logs.info(`CI mode exiting: ${exitReason}`, "UI")
			// Small delay for cleanup and final message display
			setTimeout(() => {
				onExit()
			}, 500)
		}
	}, [shouldExit, exitReason, options.ci, onExit])

	// Execute prompt automatically on mount if provided
	useEffect(() => {
		if (options.prompt && !promptExecutedRef.current && configValidation.valid) {
			// If a session was restored, wait for the resume ask to arrive
			// This ensures the prompt answers the resume ask instead of sending too early.
			if (shouldWaitForResumeAsk(taskResumedViaSession, hasActiveTask, lastChatMessage)) {
				logs.debug("Waiting for resume ask before executing prompt", "UI")
				return
			}

			promptExecutedRef.current = true
			const trimmedPrompt = options.prompt.trim()

			if (trimmedPrompt) {
				logs.debug("Executing initial prompt", "UI", { prompt: trimmedPrompt })

				// Clear the session restoration flag after prompt execution starts
				if (taskResumedViaSession) {
					logs.debug("Resetting session restoration flags after prompt execution", "UI")
					setCiCompletionIgnoreBeforeTimestamp(lastChatMessage?.ts ?? Date.now())
					setTaskResumedViaSession(false)
					setCiCompletionDetected(false)
				}

				// Commands are always executed, regardless of resume ask state
				// This ensures /exit, /clear, etc. work correctly even when resuming a session
				if (isCommandInput(trimmedPrompt)) {
					executeCommand(trimmedPrompt, onExit)
				} else {
					const shouldAnswerResumeAsk = taskResumedViaSession && isResumeAskMessage(lastChatMessage)

					// Check if there are CLI attachments to load
					if (options.attachments && options.attachments.length > 0) {
						// Async IIFE to load attachments and send message
						;(async () => {
							logs.debug("Loading CLI attachments", "UI", { count: options.attachments!.length })
							const result = await processImagePaths(options.attachments!)

							// Check for any errors - if any attachment fails, abort the task
							if (result.errors.length > 0) {
								const errorMsg = result.errors
									.map((e) => `Failed to load attachment "${e.path}": ${e.error}`)
									.join("\n")
								logs.error("Attachment loading failed, aborting task", "UI", { error: errorMsg })
								const now = Date.now()
								addMessage({
									id: `attach-err-${now}-${Math.random()}`,
									type: "error",
									content: errorMsg,
									ts: now,
								})
								// Exit in CI mode since we cannot proceed
								if (options.ci) {
									setTimeout(() => onExit(), 500)
								}
								return
							}

							logs.debug("Sending prompt with attachments", "UI", {
								textLength: trimmedPrompt.length,
								imageCount: result.images.length,
							})
							// Respond to resume ask if present, otherwise start a new task
							if (shouldAnswerResumeAsk) {
								await sendAskResponse({
									response: "messageResponse",
									text: trimmedPrompt,
									images: result.images,
								})
							} else {
								await sendMessage({ type: "newTask", text: trimmedPrompt, images: result.images })
							}
						})()
					} else if (shouldAnswerResumeAsk) {
						void sendAskResponse({ response: "messageResponse", text: trimmedPrompt })
					} else {
						sendUserMessage(trimmedPrompt)
					}
				}
			}
		}
	}, [
		options.prompt,
		options.attachments,
		options.ci,
		taskResumedViaSession,
		hasActiveTask,
		configValidation.valid,
		executeCommand,
		sendUserMessage,
		sendMessage,
		sendAskResponse,
		addMessage,
		onExit,
		lastChatMessage,
		setCiCompletionIgnoreBeforeTimestamp,
		setTaskResumedViaSession,
		setCiCompletionDetected,
	])

	// Simplified submit handler that delegates to appropriate hook
	const handleSubmit = useCallback(
		async (input: string) => {
			const trimmedInput = input.trim()
			if (!trimmedInput) return

			// Add to history
			await addToHistory(trimmedInput)

			// Exit history mode and reset navigation state
			exitHistoryMode()
			resetHistoryNavigation()

			// Determine if it's a command or regular message
			if (isCommandInput(trimmedInput)) {
				// Handle as command
				await executeCommand(trimmedInput, onExit)
			} else {
				// Handle as regular message
				await sendUserMessage(trimmedInput)
			}
		},
		[executeCommand, sendUserMessage, onExit, addToHistory, resetHistoryNavigation, exitHistoryMode],
	)

	// Determine if any operation is in progress
	const isAnyOperationInProgress = isStreaming || isExecutingCommand || isSendingMessage

	// Show welcome message as a CliMessage on first render
	useEffect(() => {
		// Skip if noSplash option is enabled
		if (options.noSplash) {
			return
		}

		if (!welcomeShownRef.current) {
			welcomeShownRef.current = true
			addMessage(
				createWelcomeMessage({
					clearScreen: !options.ci && configValidation.valid,
					showInstructions: !options.ci || !options.prompt,
					instructions: createConfigErrorInstructions(configValidation),
					...(options.parallel &&
						options.worktreeBranch && {
							worktreeBranch: options.worktreeBranch,
							workspace: options.workspace,
						}),
				}),
			)
		}
	}, [
		addMessage,
		options.ci,
		configValidation,
		options.prompt,
		options.parallel,
		options.worktreeBranch,
		options.noSplash,
	])

	useEffect(() => {
		const checkVersion = async () => {
			setVersionStatus(await getAutoUpdateStatus())
		}

		if (!autoUpdatedCheckedRef.current && !options.ci && process.env.KILO_EPHEMERAL_MODE !== "true") {
			autoUpdatedCheckedRef.current = true
			checkVersion()
		}
	}, [options.ci])

	// Show update or notification messages
	useEffect(() => {
		if (!versionStatus) return

		if (versionStatus.isOutdated) {
			addMessage(generateUpdateAvailableMessage(versionStatus))
		} else if (notifications.length > 0 && notifications[0]) {
			// Only show notification if there's no pending update
			addMessage(generateNotificationMessage(notifications[0]))
		}
	}, [notifications, versionStatus, addMessage])

	// Fetch task history on mount if not in CI mode
	const taskHistoryFetchedRef = useRef(false)
	useEffect(() => {
		if (!taskHistoryFetchedRef.current && !options.ci && configValidation.valid) {
			taskHistoryFetchedRef.current = true
			fetchTaskHistory()
		}
	}, [options.ci, configValidation.valid, fetchTaskHistory])

	// Exit if provider configuration is invalid
	useEffect(() => {
		if (!configValidation.valid) {
			logs.error("Invalid configuration", "UI", { errors: configValidation.errors })
			// Give time for the welcome message to render
			setTimeout(() => {
				onExit()
			}, 500)
		}
	}, [configValidation])

	// If JSON mode is enabled, use JSON renderer instead of UI components
	if (options.json && (options.ci || options.jsonInteractive)) {
		return <JsonRenderer jsonInteractive={options.jsonInteractive === true} />
	}

	return (
		// Using stdout.rows causes layout shift during renders
		<Box key={resetCounter} flexDirection="column">
			<Box flexDirection="column" overflow="hidden">
				<MessageDisplay />
			</Box>

			{error && (
				<Box borderStyle="round" borderColor={theme.semantic.error} paddingX={1} marginY={1}>
					<Text color={theme.semantic.error}>⚠ {error}</Text>
				</Box>
			)}

			{!options.ci && configValidation.valid && (
				<>
					<StatusIndicator disabled={false} />
					<CommandInput onSubmit={handleSubmit} disabled={isAnyOperationInProgress} />
					<StatusBar />
				</>
			)}
		</Box>
	)
}
