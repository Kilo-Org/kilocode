/**
 * CommandUI - Main application component for command-based UI
 * Refactored to use specialized hooks for better maintainability
 */

import React, { useCallback, useEffect, useRef, useState } from "react"
import { Box, Text } from "ink"
import { useAtomValue, useSetAtom } from "jotai"
import { isStreamingAtom, errorAtom, addMessageAtom, messageResetCounterAtom } from "../state/atoms/ui.js"
import { setCIModeAtom } from "../state/atoms/ci.js"
import { configValidationAtom } from "../state/atoms/config.js"
import { isParallelModeAtom } from "../state/atoms/index.js"
import { addToHistoryAtom, resetHistoryNavigationAtom, exitHistoryModeAtom } from "../state/atoms/history.js"
import { MessageDisplay } from "./messages/MessageDisplay.js"
import { JsonRenderer } from "./JsonRenderer.js"
import { CommandInput } from "./components/CommandInput.js"
import { StatusBar } from "./components/StatusBar.js"
import { StatusIndicator } from "./components/StatusIndicator.js"
import { initializeCommands } from "../commands/index.js"
import { isCommandInput } from "../services/autocomplete.js"
import { useCommandHandler } from "../state/hooks/useCommandHandler.js"
import { useMessageHandler } from "../state/hooks/useMessageHandler.js"
import { useFollowupHandler } from "../state/hooks/useFollowupHandler.js"
import { useApprovalMonitor } from "../state/hooks/useApprovalMonitor.js"
import { useProfile } from "../state/hooks/useProfile.js"
import { useCIMode } from "../state/hooks/useCIMode.js"
import { useTheme } from "../state/hooks/useTheme.js"
import { AppOptions } from "./App.js"
import { logs } from "../services/logs.js"
import { createConfigErrorInstructions, createWelcomeMessage } from "./utils/welcomeMessage.js"
import { generateUpdateAvailableMessage, getAutoUpdateStatus } from "../utils/auto-update.js"
import { generateNotificationMessage } from "../utils/notifications.js"
import { notificationsAtom } from "../state/atoms/notifications.js"
import { useTerminal } from "../state/hooks/useTerminal.js"

// Initialize commands on module load
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

	// Initialize CI mode configuration
	const setCIMode = useSetAtom(setCIModeAtom)
	const addMessage = useSetAtom(addMessageAtom)
	const addToHistory = useSetAtom(addToHistoryAtom)
	const resetHistoryNavigation = useSetAtom(resetHistoryNavigationAtom)
	const exitHistoryMode = useSetAtom(exitHistoryModeAtom)
	const setIsParallelMode = useSetAtom(isParallelModeAtom)

	// Use specialized hooks for command and message handling
	const { executeCommand, isExecuting: isExecutingCommand } = useCommandHandler()
	const { sendUserMessage, isSending: isSendingMessage } = useMessageHandler({
		...(options.ci !== undefined && { ciMode: options.ci }),
	})

	// Followup handler hook for automatic suggestion population
	useFollowupHandler()

	// Approval monitor hook for centralized approval handling
	useApprovalMonitor()

	// Profile hook for handling profile/balance data responses
	useProfile()

	// This clears the terminal and forces re-render of static components
	useTerminal()

	// CI mode hook for automatic exit
	const { shouldExit, exitReason } = useCIMode({
		enabled: options.ci || false,
		...(options.timeout !== undefined && { timeout: options.timeout }),
		onExit: onExit,
	})

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

	// Set parallel mode flag
	useEffect(() => {
		if (options.parallel) {
			setIsParallelMode(true)
		}
	}, [options.parallel, setIsParallelMode])

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
			promptExecutedRef.current = true
			const trimmedPrompt = options.prompt.trim()

			if (trimmedPrompt) {
				logs.debug("Executing initial prompt", "UI", { prompt: trimmedPrompt })

				// Determine if it's a command or regular message
				if (isCommandInput(trimmedPrompt)) {
					executeCommand(trimmedPrompt, onExit)
				} else {
					sendUserMessage(trimmedPrompt)
				}
			}
		}
	}, [options.prompt])

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
	}, [addMessage, options.ci, configValidation, options.prompt, options.parallel, options.worktreeBranch])

	useEffect(() => {
		const checkVersion = async () => {
			setVersionStatus(await getAutoUpdateStatus())
		}

		if (!autoUpdatedCheckedRef.current && !options.ci) {
			autoUpdatedCheckedRef.current = true
			checkVersion()
		}
	}, [])

	useEffect(() => {
		if (!versionStatus) return

		if (versionStatus.isOutdated) {
			addMessage(generateUpdateAvailableMessage(versionStatus))
		} else if (notifications.length > 0 && notifications[0]) {
			// Only show notification if there's no pending update
			addMessage(generateNotificationMessage(notifications[0]))
		}
	}, [notifications, versionStatus])

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
	if (options.json && options.ci) {
		return <JsonRenderer />
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
