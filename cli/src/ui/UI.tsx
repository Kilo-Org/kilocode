/**
 * CommandUI - Main application component for command-based UI
 * Refactored to use specialized hooks for better maintainability
 */

import React, { useCallback, useEffect, useRef } from "react"
import { Box, Text } from "ink"
import { useAtomValue, useSetAtom } from "jotai"
import { isStreamingAtom, errorAtom, addMessageAtom } from "../state/atoms/ui.js"
import { setCIModeAtom } from "../state/atoms/ci.js"
import { configValidationAtom } from "../state/atoms/config.js"
import { addToHistoryAtom, resetHistoryNavigationAtom, exitHistoryModeAtom } from "../state/atoms/history.js"
import { MessageDisplay } from "./messages/MessageDisplay.js"
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
import { useTerminalResize } from "../state/hooks/useTerminalResize.js"
import { AppOptions } from "./App.js"
import { logs } from "../services/logs.js"
import { createConfigErrorInstructions, createWelcomeMessage } from "./utils/welcomeMessage.js"
import { generateUpdateAvailableMessage, getAutoUpdateStatus } from "../utils/auto-update.js"

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

	// Initialize CI mode configuration
	const setCIMode = useSetAtom(setCIModeAtom)
	const addMessage = useSetAtom(addMessageAtom)
	const addToHistory = useSetAtom(addToHistoryAtom)
	const resetHistoryNavigation = useSetAtom(resetHistoryNavigationAtom)
	const exitHistoryMode = useSetAtom(exitHistoryModeAtom)

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

	// CI mode hook for automatic exit
	const { shouldExit, exitReason } = useCIMode({
		enabled: options.ci || false,
		...(options.timeout !== undefined && { timeout: options.timeout }),
		onExit: onExit,
	})

	// Terminal resize hook for handling terminal size changes
	// This clears the terminal and forces re-render of static components
	useTerminalResize()

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
				}),
			)
		}
	}, [options.ci, options.prompt, addMessage, configValidation])

	// Auto-update check on mount
	const checkVersion = async () => {
		const status = await getAutoUpdateStatus()
		if (status.isOutdated) {
			addMessage(generateUpdateAvailableMessage(status))
		}
	}

	useEffect(() => {
		if (!autoUpdatedCheckedRef.current && !options.ci) {
			autoUpdatedCheckedRef.current = true
			checkVersion()
		}
	}, [])

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

	return (
		// Using stdout.rows causes layout shift during renders
		<Box flexDirection="column">
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
