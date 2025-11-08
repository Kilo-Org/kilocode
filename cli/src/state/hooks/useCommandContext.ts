/**
 * Hook for creating CommandContext objects
 * Encapsulates all dependencies needed for command execution
 */

import { useSetAtom, useAtomValue } from "jotai"
import { useCallback } from "react"
import type { CommandContext } from "../../commands/core/types.js"
import type { CliMessage } from "../../types/cli.js"
import {
	addMessageAtom,
	clearMessagesAtom,
	replaceMessagesAtom,
	setMessageCutoffTimestampAtom,
	isCommittingParallelModeAtom,
	refreshTerminalAtom,
} from "../atoms/ui.js"
import { setModeAtom, setThemeAtom, providerAtom, updateProviderAtom, configAtom } from "../atoms/config.js"
import { routerModelsAtom, extensionStateAtom, isParallelModeAtom } from "../atoms/extension.js"
import { requestRouterModelsAtom } from "../atoms/actions.js"
import { profileDataAtom, balanceDataAtom, profileLoadingAtom, balanceLoadingAtom } from "../atoms/profile.js"
import {
	taskHistoryDataAtom,
	taskHistoryFiltersAtom,
	taskHistoryLoadingAtom,
	taskHistoryErrorAtom,
} from "../atoms/taskHistory.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { useTaskHistory } from "./useTaskHistory.js"
import { getModelIdKey } from "../../constants/providers/models.js"

const TERMINAL_CLEAR_DELAY_MS = 500

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
	const setTheme = useSetAtom(setThemeAtom)
	const updateProvider = useSetAtom(updateProviderAtom)
	const refreshRouterModels = useSetAtom(requestRouterModelsAtom)
	const setMessageCutoffTimestamp = useSetAtom(setMessageCutoffTimestampAtom)
	const setCommittingParallelMode = useSetAtom(isCommittingParallelModeAtom)
	const refreshTerminal = useSetAtom(refreshTerminalAtom)
	const { sendMessage, clearTask } = useWebviewMessage()

	// Get read-only state
	const routerModels = useAtomValue(routerModelsAtom)
	const currentProvider = useAtomValue(providerAtom)
	const extensionState = useAtomValue(extensionStateAtom)
	const kilocodeDefaultModel = extensionState?.kilocodeDefaultModel || ""
	const isParallelMode = useAtomValue(isParallelModeAtom)
	const config = useAtomValue(configAtom)

	// Get profile state
	const profileData = useAtomValue(profileDataAtom)
	const balanceData = useAtomValue(balanceDataAtom)
	const profileLoading = useAtomValue(profileLoadingAtom)
	const balanceLoading = useAtomValue(balanceLoadingAtom)

	// Get task history state and functions
	const taskHistoryData = useAtomValue(taskHistoryDataAtom)
	const taskHistoryFilters = useAtomValue(taskHistoryFiltersAtom)
	const taskHistoryLoading = useAtomValue(taskHistoryLoadingAtom)
	const taskHistoryError = useAtomValue(taskHistoryErrorAtom)
	const {
		fetchTaskHistory,
		updateFilters: updateTaskHistoryFiltersAndFetch,
		changePage: changeTaskHistoryPageAndFetch,
		nextPage: nextTaskHistoryPage,
		previousPage: previousTaskHistoryPage,
	} = useTaskHistory()

	// Create the factory function
	const createContext = useCallback<CommandContextFactory>(
		(input: string, args: string[], options: Record<string, any>, onExit: () => void): CommandContext => {
			return {
				input,
				args,
				options,
				config,
				sendMessage: async (message: any) => {
					await sendMessage(message)
				},
				addMessage: (message: CliMessage) => {
					addMessage(message)
				},
				clearMessages: () => {
					clearMessages()
				},
				refreshTerminal: () => {
					return new Promise<void>((resolve) => {
						refreshTerminal()
						setTimeout(() => {
							resolve()
						}, TERMINAL_CLEAR_DELAY_MS)
					})
				},
				replaceMessages: (messages: CliMessage[]) => {
					replaceMessages(messages)
				},
				setMessageCutoffTimestamp: (timestamp: number) => {
					setMessageCutoffTimestamp(timestamp)
				},
				clearTask: async () => {
					await clearTask()
				},
				setMode: async (mode: string) => {
					await setMode(mode)
				},
				setTheme: async (theme: string) => {
					await setTheme(theme)
				},
				exit: () => {
					onExit()
				},
				setCommittingParallelMode: (isCommitting: boolean) => {
					setCommittingParallelMode(isCommitting)
				},
				isParallelMode,
				// Model-related context
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
				// Provider update function for teams command
				updateProvider: async (providerId: string, updates: any) => {
					await updateProvider(providerId, updates)
				},
				// Profile data context
				profileData,
				balanceData,
				profileLoading,
				balanceLoading,
				// Task history context
				taskHistoryData,
				taskHistoryFilters,
				taskHistoryLoading,
				taskHistoryError,
				fetchTaskHistory,
				updateTaskHistoryFilters: updateTaskHistoryFiltersAndFetch,
				changeTaskHistoryPage: changeTaskHistoryPageAndFetch,
				nextTaskHistoryPage,
				previousTaskHistoryPage,
				sendWebviewMessage: sendMessage,
			}
		},
		[
			config,
			addMessage,
			clearMessages,
			setMode,
			setTheme,
			sendMessage,
			clearTask,
			refreshTerminal,
			routerModels,
			currentProvider,
			kilocodeDefaultModel,
			updateProvider,
			refreshRouterModels,
			replaceMessages,
			setMessageCutoffTimestamp,
			profileData,
			balanceData,
			profileLoading,
			balanceLoading,
			setCommittingParallelMode,
			isParallelMode,
			taskHistoryData,
			taskHistoryFilters,
			taskHistoryLoading,
			taskHistoryError,
			fetchTaskHistory,
			updateTaskHistoryFiltersAndFetch,
			changeTaskHistoryPageAndFetch,
			nextTaskHistoryPage,
			previousTaskHistoryPage,
		],
	)

	return { createContext }
}
