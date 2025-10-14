/**
 * Hook for creating CommandContext objects
 * Encapsulates all dependencies needed for command execution
 */

import { useSetAtom, useAtomValue } from "jotai"
import { useCallback } from "react"
import type { CommandContext } from "../../commands/core/types.js"
import type { CliMessage } from "../../types/cli.js"
import { addMessageAtom, clearMessagesAtom, replaceMessagesAtom } from "../atoms/ui.js"
import { setModeAtom, providerAtom, updateProviderAtom } from "../atoms/config.js"
import { routerModelsAtom, extensionStateAtom } from "../atoms/extension.js"
import { requestRouterModelsAtom } from "../atoms/actions.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { getModelIdKey } from "../../constants/providers/models.js"

/**
 * Factory function type for creating CommandContext
 */
export type CommandContextFactory = (
	input: string,
	args: string[],
	options: Record<string, any>,
	onExit: () => void,
) => CommandContext

/**
 * Return type for useCommandContext hook
 */
export interface UseCommandContextReturn {
	/** Factory function to create CommandContext objects */
	createContext: CommandContextFactory
}

/**
 * Hook that provides a factory for creating CommandContext objects
 *
 * This hook encapsulates all the dependencies needed to create a CommandContext,
 * making it easier to test and reuse command execution logic.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { createContext } = useCommandContext()
 *
 *   const handleCommand = (input: string, args: string[], options: Record<string, any>) => {
 *     const context = createContext(input, args, options, onExit)
 *     await command.handler(context)
 *   }
 * }
 * ```
 */
export function useCommandContext(): UseCommandContextReturn {
	// Get atoms and hooks
	const addMessage = useSetAtom(addMessageAtom)
	const clearMessages = useSetAtom(clearMessagesAtom)
	const replaceMessages = useSetAtom(replaceMessagesAtom)
	const setMode = useSetAtom(setModeAtom)
	const updateProvider = useSetAtom(updateProviderAtom)
	const refreshRouterModels = useSetAtom(requestRouterModelsAtom)
	const { sendMessage, clearTask } = useWebviewMessage()

	// Get read-only state
	const routerModels = useAtomValue(routerModelsAtom)
	const currentProvider = useAtomValue(providerAtom)
	const extensionState = useAtomValue(extensionStateAtom)
	const kilocodeDefaultModel = extensionState?.kilocodeDefaultModel || ""

	// Create the factory function
	const createContext = useCallback<CommandContextFactory>(
		(input: string, args: string[], options: Record<string, any>, onExit: () => void): CommandContext => {
			return {
				input,
				args,
				options,
				sendMessage: async (message: any) => {
					await sendMessage(message)
				},
				addMessage: (message: CliMessage) => {
					addMessage(message)
				},
				clearMessages: () => {
					clearMessages()
				},
				replaceMessages: (messages: CliMessage[]) => {
					replaceMessages(messages)
				},
				clearTask: async () => {
					await clearTask()
				},
				setMode: async (mode: string) => {
					await setMode(mode)
				},
				exit: () => {
					onExit()
				},
				// New model-related context
				routerModels,
				currentProvider: currentProvider || null,
				kilocodeDefaultModel,
				updateProviderModel: async (modelId: string) => {
					if (!currentProvider) {
						throw new Error("No provider configured")
					}

					const modelIdKey = getModelIdKey(currentProvider.provider)
					await updateProvider(currentProvider.id, {
						[modelIdKey]: modelId,
					})
				},
				refreshRouterModels: async () => {
					await refreshRouterModels()
				},
			}
		},
		[
			addMessage,
			clearMessages,
			setMode,
			sendMessage,
			clearTask,
			routerModels,
			currentProvider,
			kilocodeDefaultModel,
			updateProvider,
			refreshRouterModels,
		],
	)

	return { createContext }
}
