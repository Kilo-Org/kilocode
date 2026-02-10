/**
 * Condense context state management atoms
 * Handles pending condense requests and their resolution
 */

import { atom } from "jotai"
import { logs } from "../../services/logs.js"

/**
 * Pending condense request resolver
 */
interface PendingCondenseRequest {
	taskId: string
	resolve: () => void
	reject: (error: Error) => void
	timeout: NodeJS.Timeout
}

/**
 * Map of pending condense requests waiting for responses
 * Key is the taskId
 */
export const condensePendingRequestsAtom = atom<Map<string, PendingCondenseRequest>>(new Map())

/**
 * Action atom to add a pending condense request
 */
export const addPendingCondenseRequestAtom = atom(
	null,
	(
		get,
		set,
		request: {
			taskId: string
			resolve: () => void
			reject: (error: Error) => void
			timeout: NodeJS.Timeout
		},
	) => {
		const pendingRequests = get(condensePendingRequestsAtom)
		const newPendingRequests = new Map(pendingRequests)
		newPendingRequests.set(request.taskId, request)
		set(condensePendingRequestsAtom, newPendingRequests)
		logs.debug(`Added pending condense request for task: ${request.taskId}`, "condense")
	},
)

/**
 * Action atom to remove a pending condense request
 */
export const removePendingCondenseRequestAtom = atom(null, (get, set, taskId: string) => {
	const pendingRequests = get(condensePendingRequestsAtom)
	const request = pendingRequests.get(taskId)
	if (request) {
		clearTimeout(request.timeout)
		const newPendingRequests = new Map(pendingRequests)
		newPendingRequests.delete(taskId)
		set(condensePendingRequestsAtom, newPendingRequests)
		logs.debug(`Removed pending condense request for task: ${taskId}`, "condense")
	}
})

/**
 * Action atom to resolve a pending condense request
 */
export const resolveCondenseRequestAtom = atom(
	null,
	(get, set, { taskId, error }: { taskId: string; error?: string }) => {
		const pendingRequests = get(condensePendingRequestsAtom)
		const request = pendingRequests.get(taskId)

		if (request) {
			clearTimeout(request.timeout)
			if (error) {
				logs.error(`Condense request failed for task ${taskId}: ${error}`, "condense")
				request.reject(new Error(error))
			} else {
				logs.info(`Condense request completed for task: ${taskId}`, "condense")
				request.resolve()
			}
			// Remove from pending requests
			const newPendingRequests = new Map(pendingRequests)
			newPendingRequests.delete(taskId)
			set(condensePendingRequestsAtom, newPendingRequests)
		} else {
			logs.debug(`No pending condense request found for task: ${taskId}`, "condense")
		}
	},
)

/**
 * Default timeout for condense requests (60 seconds)
 * Condensation can take a while depending on conversation size
 */
export const CONDENSE_REQUEST_TIMEOUT_MS = 60000
