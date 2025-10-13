/**
 * CommandUI - Main application component for command-based UI
 * Refactored to use specialized hooks for better maintainability
 */

import React, { useCallback, useEffect, useRef } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { useAtomValue, useSetAtom } from "jotai"
import { isProcessingAtom, errorAtom, addMessageAtom } from "../state/atoms/ui.js"
import { setCIModeAtom } from "../state/atoms/ci.js"
import { MessageDisplay } from "./messages/MessageDisplay.js"
import { CommandInput } from "./components/CommandInput.js"
import { StatusBar } from "./components/StatusBar.js"
import { initializeCommands } from "../commands/index.js"
import { isCommandInput } from "../services/autocomplete.js"
import { useCommandHandler } from "../state/hooks/useCommandHandler.js"
import { useMessageHandler } from "../state/hooks/useMessageHandler.js"
import { useFollowupHandler } from "../state/hooks/useFollowupHandler.js"
import { useCIMode } from "../state/hooks/useCIMode.js"
import useIsProcessingSubscription from "../state/hooks/useIsProcessingSubscription.js"
import { useTheme } from "../state/hooks/useTheme.js"
import { AppOptions } from "./App.js"
import { logs } from "../services/logs.js"
import { createWelcomeMessage } from "./utils/welcomeMessage.js"

// Initialize commands on module load
initializeCommands()

interface UIAppProps {
	options: AppOptions
	onExit: () => void
}

export const UI: React.FC<UIAppProps> = ({ options, onExit }) => {
	const { stdout } = useStdout()
	const isProcessing = useAtomValue(isProcessingAtom)
	const error = useAtomValue(errorAtom)
	const theme = useTheme()

	// Initialize CI mode configuration
	const setCIMode = useSetAtom(setCIModeAtom)
	const addMessage = useSetAtom(addMessageAtom)

	// Use specialized hooks for command and message handling
	const { executeCommand, isExecuting: isExecutingCommand } = useCommandHandler()
	const { sendUserMessage, isSending: isSendingMessage } = useMessageHandler({
		...(options.ci !== undefined && { ciMode: options.ci }),
	})

	// Followup handler hook for automatic suggestion population
	useFollowupHandler()

	useIsProcessingSubscription()

	// CI mode hook for automatic exit
	const { shouldExit, exitReason } = useCIMode({
		enabled: options.ci || false,
		...(options.timeout !== undefined && { timeout: options.timeout }),
		onExit: onExit,
	})

	// Track if prompt has been executed and welcome message shown
	const promptExecutedRef = useRef(false)
	const welcomeShownRef = useRef(false)

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
			}, 100)
		}
	}, [shouldExit, exitReason, options.ci, onExit])

	// In CI mode, we don't use useInput because it tries to enable raw mode on stdin
	// which fails when stdin is piped. The app stays alive through the message loop instead.
	useInput(
		() => {
			// No-op: we don't handle input in CI mode
		},
		{ isActive: !options.ci },
	)

	// Execute prompt automatically on mount if provided
	useEffect(() => {
		if (options.prompt && !promptExecutedRef.current) {
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
	}, [options.prompt, executeCommand, sendUserMessage, onExit])

	// Simplified submit handler that delegates to appropriate hook
	const handleSubmit = useCallback(
		async (input: string) => {
			const trimmedInput = input.trim()
			if (!trimmedInput) return

			// Determine if it's a command or regular message
			if (isCommandInput(trimmedInput)) {
				// Handle as command
				await executeCommand(trimmedInput, onExit)
			} else {
				// Handle as regular message
				await sendUserMessage(trimmedInput)
			}
		},
		[executeCommand, sendUserMessage, onExit],
	)

	// Determine if any operation is in progress
	const isAnyOperationInProgress = isProcessing || isExecutingCommand || isSendingMessage

	// Show welcome message as a CliMessage on first render
	useEffect(() => {
		if (!welcomeShownRef.current) {
			welcomeShownRef.current = true

			addMessage(
				createWelcomeMessage({
					clearScreen: !options.ci,
					showInstructions: !options.ci || !options.prompt,
				}),
			)
		}
	}, [options.ci, options.prompt, addMessage])

	return (
		// Using stdout.rows causes layout shift during renders
		<Box flexDirection="column">
			<Box flexDirection="column" overflow="hidden">
				<MessageDisplay />
			</Box>

			{error && (
				<Box borderStyle="single" borderColor={theme.semantic.error} paddingX={1} marginY={1}>
					<Text color={theme.semantic.error}>⚠ {error}</Text>
				</Box>
			)}

			{!options.ci && (
				<>
					{isProcessing && <Text color={theme.ui.text.dimmed}>Thinking...</Text>}
					<CommandInput onSubmit={handleSubmit} disabled={isAnyOperationInProgress} />
					<StatusBar />
				</>
			)}
		</Box>
	)
}
