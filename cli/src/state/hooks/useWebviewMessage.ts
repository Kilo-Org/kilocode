/**
 * Hook for sending webview messages to the extension
 * Provides type-safe message sending helpers with error handling
 */

import { useSetAtom } from "jotai"
import { useCallback, useMemo } from "react"
import type { WebviewMessage, ClineAskResponse } from "../../types/messages.js"
import {
	sendWebviewMessageAtom,
	sendTaskAtom,
	sendAskResponseAtom,
	requestRouterModelsAtom,
	clearTaskAtom,
	cancelTaskAtom,
	resumeTaskAtom,
	switchModeAtom,
	respondToToolAtom,
	sendApiConfigurationAtom,
	sendCustomInstructionsAtom,
	sendAlwaysAllowAtom,
	openFileAtom,
	openSettingsAtom,
	refreshStateAtom,
	sendPrimaryButtonClickAtom,
	sendSecondaryButtonClickAtom,
} from "../atoms/actions.js"

/**
 * Parameters for sending a new task
 */
export interface SendTaskParams {
	/** The task text/prompt */
	text: string
	/** Optional images to include */
	images?: string[]
	/** Optional mode to use */
	mode?: string
}

/**
 * Parameters for sending an ask response
 */
export interface SendAskResponseParams {
	/** The response type */
	response?: ClineAskResponse
	/** The action to take */
	action?: string
	/** Additional text */
	text?: string
	/** Optional images */
	images?: string[]
}

/**
 * Parameters for responding to a tool use
 */
export interface RespondToToolParams {
	/** Whether to approve or reject */
	response: "yesButtonClicked" | "noButtonClicked"
	/** Optional feedback text */
	text?: string
	/** Optional images */
	images?: string[]
}

/**
 * Return type for useWebviewMessage hook
 */
export interface UseWebviewMessageReturn {
	/** Send a raw webview message */
	sendMessage: (message: WebviewMessage) => Promise<void>
	/** Send a new task */
	sendTask: (params: SendTaskParams) => Promise<void>
	/** Send an ask response */
	sendAskResponse: (params: SendAskResponseParams) => Promise<void>
	/** Request router models */
	requestRouterModels: () => Promise<void>
	/** Clear the current task */
	clearTask: () => Promise<void>
	/** Cancel the current task */
	cancelTask: () => Promise<void>
	/** Resume a paused task */
	resumeTask: () => Promise<void>
	/** Switch to a different mode */
	switchMode: (mode: string) => Promise<void>
	/** Respond to a tool use request */
	respondToTool: (params: RespondToToolParams) => Promise<void>
	/** Send API configuration */
	sendApiConfiguration: (config: unknown) => Promise<void>
	/** Send custom instructions */
	sendCustomInstructions: (instructions: string) => Promise<void>
	/** Send always allow setting */
	sendAlwaysAllow: (alwaysAllow: boolean) => Promise<void>
	/** Open a file in the editor */
	openFile: (filePath: string) => Promise<void>
	/** Open settings */
	openSettings: () => Promise<void>
	/** Refresh extension state */
	refreshState: () => Promise<void>
	/** Send primary button click */
	sendPrimaryButtonClick: () => Promise<void>
	/** Send secondary button click */
	sendSecondaryButtonClick: () => Promise<void>
}

/**
 * Hook for sending webview messages to the extension
 *
 * Provides type-safe helpers for common message types with built-in error handling.
 * All methods are async and will throw errors if the service is not ready.
 *
 * @example
 * ```tsx
 * function TaskInput() {
 *   const { sendTask, isReady } = useWebviewMessage()
 *   const [input, setInput] = useState('')
 *
 *   const handleSubmit = async () => {
 *     try {
 *       await sendTask({ text: input })
 *       setInput('')
 *     } catch (error) {
 *       console.error('Failed to send task:', error)
 *     }
 *   }
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <input value={input} onChange={e => setInput(e.target.value)} />
 *       <button disabled={!isReady}>Send</button>
 *     </form>
 *   )
 * }
 * ```
 */
export function useWebviewMessage(): UseWebviewMessageReturn {
	// Get action atoms
	const sendMessage = useSetAtom(sendWebviewMessageAtom)
	const sendTaskAction = useSetAtom(sendTaskAtom)
	const sendAskResponseAction = useSetAtom(sendAskResponseAtom)
	const requestRouterModelsAction = useSetAtom(requestRouterModelsAtom)
	const clearTaskAction = useSetAtom(clearTaskAtom)
	const cancelTaskAction = useSetAtom(cancelTaskAtom)
	const resumeTaskAction = useSetAtom(resumeTaskAtom)
	const switchModeAction = useSetAtom(switchModeAtom)
	const respondToToolAction = useSetAtom(respondToToolAtom)
	const sendApiConfigurationAction = useSetAtom(sendApiConfigurationAtom)
	const sendCustomInstructionsAction = useSetAtom(sendCustomInstructionsAtom)
	const sendAlwaysAllowAction = useSetAtom(sendAlwaysAllowAtom)
	const openFileAction = useSetAtom(openFileAtom)
	const openSettingsAction = useSetAtom(openSettingsAtom)
	const refreshStateAction = useSetAtom(refreshStateAtom)
	const sendPrimaryButtonClickAction = useSetAtom(sendPrimaryButtonClickAtom)
	const sendSecondaryButtonClickAction = useSetAtom(sendSecondaryButtonClickAtom)

	// Wrap actions with useCallback for stable references
	const sendTask = useCallback(
		async (params: SendTaskParams) => {
			await sendTaskAction(params)
		},
		[sendTaskAction],
	)

	const sendAskResponse = useCallback(
		async (params: SendAskResponseParams) => {
			await sendAskResponseAction(params)
		},
		[sendAskResponseAction],
	)

	const requestRouterModels = useCallback(async () => {
		await requestRouterModelsAction()
	}, [requestRouterModelsAction])

	const clearTask = useCallback(async () => {
		await clearTaskAction()
	}, [clearTaskAction])

	const cancelTask = useCallback(async () => {
		await cancelTaskAction()
	}, [cancelTaskAction])

	const resumeTask = useCallback(async () => {
		await resumeTaskAction()
	}, [resumeTaskAction])

	const switchMode = useCallback(
		async (mode: string) => {
			await switchModeAction(mode)
		},
		[switchModeAction],
	)

	const respondToTool = useCallback(
		async (params: RespondToToolParams) => {
			await respondToToolAction(params)
		},
		[respondToToolAction],
	)

	const sendApiConfiguration = useCallback(
		async (config: unknown) => {
			await sendApiConfigurationAction(config as Parameters<typeof sendApiConfigurationAction>[0])
		},
		[sendApiConfigurationAction],
	)

	const sendCustomInstructions = useCallback(
		async (instructions: string) => {
			await sendCustomInstructionsAction(instructions)
		},
		[sendCustomInstructionsAction],
	)

	const sendAlwaysAllow = useCallback(
		async (alwaysAllow: boolean) => {
			await sendAlwaysAllowAction(alwaysAllow)
		},
		[sendAlwaysAllowAction],
	)

	const openFile = useCallback(
		async (filePath: string) => {
			await openFileAction(filePath)
		},
		[openFileAction],
	)

	const openSettings = useCallback(async () => {
		await openSettingsAction()
	}, [openSettingsAction])

	const refreshState = useCallback(async () => {
		await refreshStateAction()
	}, [refreshStateAction])

	const sendPrimaryButtonClick = useCallback(async () => {
		await sendPrimaryButtonClickAction()
	}, [sendPrimaryButtonClickAction])

	const sendSecondaryButtonClick = useCallback(async () => {
		await sendSecondaryButtonClickAction()
	}, [sendSecondaryButtonClickAction])

	// Memoize return value
	return useMemo(
		() => ({
			sendMessage,
			sendTask,
			sendAskResponse,
			requestRouterModels,
			clearTask,
			cancelTask,
			resumeTask,
			switchMode,
			respondToTool,
			sendApiConfiguration,
			sendCustomInstructions,
			sendAlwaysAllow,
			openFile,
			openSettings,
			refreshState,
			sendPrimaryButtonClick,
			sendSecondaryButtonClick,
		}),
		[
			sendMessage,
			sendTask,
			sendAskResponse,
			requestRouterModels,
			clearTask,
			cancelTask,
			resumeTask,
			switchMode,
			respondToTool,
			sendApiConfiguration,
			sendCustomInstructions,
			sendAlwaysAllow,
			openFile,
			openSettings,
			refreshState,
			sendPrimaryButtonClick,
			sendSecondaryButtonClick,
		],
	)
}
