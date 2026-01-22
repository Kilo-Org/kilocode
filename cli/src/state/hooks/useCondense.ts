/**
 * Hook for condense operations with async response handling
 */

import { useSetAtom } from "jotai"
import { useCallback } from "react"
import {
	addPendingCondenseRequestAtom,
	removePendingCondenseRequestAtom,
	CONDENSE_REQUEST_TIMEOUT_MS,
} from "../atoms/condense.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { logs } from "../../services/logs.js"

/**
 * Return type for useCondense hook
 */
export interface UseCondenseReturn {
	/**
	 * Request context condensation and wait for completion
	 * @param taskId The task ID to condense
	 * @returns Promise that resolves when condensation is complete
	 * @throws Error if condensation fails or times out
	 */
	condenseAndWait: (taskId: string) => Promise<void>
}

/**
 * Hook that provides condense functionality with async response handling
 *
 * This hook encapsulates the logic for sending a condense request and
 * waiting for the response from the extension.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { condenseAndWait } = useCondense()
 *
 *   const handleCondense = async (taskId: string) => {
 *     try {
 *       await condenseAndWait(taskId)
 *       console.log('Condensation complete')
 *     } catch (error) {
 *       console.error('Condensation failed:', error)
 *     }
 *   }
 * }
 * ```
 */
export function useCondense(): UseCondenseReturn {
	const addPendingRequest = useSetAtom(addPendingCondenseRequestAtom)
	const removePendingRequest = useSetAtom(removePendingCondenseRequestAtom)
	const { sendMessage } = useWebviewMessage()

	const condenseAndWait = useCallback(
		async (taskId: string): Promise<void> => {
			return new Promise((resolve, reject) => {
				// Set up timeout
				const timeout = setTimeout(() => {
					logs.error(`Condense request timed out for task: ${taskId}`, "useCondense")
					removePendingRequest(taskId)
					reject(new Error(`Condense request timed out after ${CONDENSE_REQUEST_TIMEOUT_MS / 1000} seconds`))
				}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add pending request
				addPendingRequest({
					taskId,
					resolve,
					reject,
					timeout,
				})

				// Send the condense request
				sendMessage({
					type: "condenseTaskContextRequest",
					text: taskId,
				}).catch((error) => {
					logs.error(`Failed to send condense request: ${error}`, "useCondense")
					removePendingRequest(taskId)
					reject(error)
				})

				logs.info(`Condense request sent for task: ${taskId}, waiting for response...`, "useCondense")
			})
		},
		[addPendingRequest, removePendingRequest, sendMessage],
	)

	return { condenseAndWait }
}
