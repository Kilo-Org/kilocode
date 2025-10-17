/**
 * Hook for handling command execution
 * Provides a high-level interface for executing commands with proper error handling
 */

import { useSetAtom } from "jotai"
import { useCallback, useState } from "react"
import { addMessageAtom } from "../atoms/ui.js"
import { ciCommandFinishedAtom } from "../atoms/ci.js"
import { useCommandContext } from "./useCommandContext.js"
import { validateCommand, executeCommandWithContext, formatCommandError } from "../../services/commandExecutor.js"
import type { CliMessage } from "../../types/cli.js"

/**
 * Return type for useCommandHandler hook
 */
export interface UseCommandHandlerReturn {
	/** Execute a command from input string */
	executeCommand: (input: string, onExit: () => void) => Promise<void>
	/** Whether a command is currently executing */
	isExecuting: boolean
}

/**
 * Hook that provides command execution functionality
 *
 * This hook encapsulates all the logic for parsing, validating, and executing commands,
 * including error handling and state management.
 *
 * @example
 * ```tsx
 * function CommandInput() {
 *   const { executeCommand, isExecuting } = useCommandHandler()
 *
 *   const handleSubmit = async (input: string) => {
 *     await executeCommand(input, () => console.log('Exit'))
 *   }
 *
 *   return (
 *     <input
 *       onSubmit={handleSubmit}
 *       disabled={isExecuting}
 *     />
 *   )
 * }
 * ```
 */
export function useCommandHandler(): UseCommandHandlerReturn {
	const [isExecuting, setIsExecuting] = useState(false)
	const addMessage = useSetAtom(addMessageAtom)
	const setCommandFinished = useSetAtom(ciCommandFinishedAtom)
	const { createContext } = useCommandContext()

	const executeCommand = useCallback(
		async (input: string, onExit: () => void): Promise<void> => {
			const trimmedInput = input.trim()

			// Validate the command
			const validation = validateCommand(trimmedInput)

			if (!validation.valid) {
				// Add error message
				const errorMessage: CliMessage = {
					id: Date.now().toString(),
					type: "error",
					content: validation.error || "Invalid command",
					ts: Date.now(),
				}
				addMessage(errorMessage)
				return
			}

			if (!validation.command || !validation.parsed) {
				// This shouldn't happen if validation passed, but TypeScript needs this check
				return
			}

			// Set processing state
			setIsExecuting(true)

			try {
				// Create command context
				const context = createContext(trimmedInput, validation.parsed.args, validation.parsed.options, onExit)

				// Execute the command
				const result = await executeCommandWithContext(validation.command, context)

				if (!result.success && result.error) {
					// Add error message if execution failed
					const errorMessage: CliMessage = {
						id: Date.now().toString(),
						type: "error",
						content: formatCommandError(validation.command, result.error),
						ts: Date.now(),
					}
					addMessage(errorMessage)
				}
			} catch (error) {
				// Handle unexpected errors
				const errorMessage: CliMessage = {
					id: Date.now().toString(),
					type: "error",
					content: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
					ts: Date.now(),
				}
				addMessage(errorMessage)
			} finally {
				// Reset executing state
				setIsExecuting(false)
				// Mark command as finished for CI mode (only for actual commands like /exit, /help, etc.)
				// For regular messages, we wait for completion_result from the extension
				setCommandFinished(true)
			}
		},
		[addMessage, setCommandFinished, createContext],
	)

	return {
		executeCommand,
		isExecuting,
	}
}
