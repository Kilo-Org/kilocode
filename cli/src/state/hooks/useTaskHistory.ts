/**
 * Hook for managing task history
 */

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useCallback } from "react"
import {
	taskHistoryDataAtom,
	taskHistoryFiltersAtom,
	taskHistoryPageIndexAtom,
	taskHistoryLoadingAtom,
	taskHistoryErrorAtom,
	updateTaskHistoryFiltersAtom,
	changeTaskHistoryPageAtom,
	addPendingRequestAtom,
	removePendingRequestAtom,
	type TaskHistoryFilters,
	type TaskHistoryData,
} from "../atoms/taskHistory.js"
import { extensionServiceAtom } from "../atoms/service.js"
import { logs } from "../../services/logs.js"
import type { TaskHistoryRequestPayload } from "../../types/messages.js"

export function useTaskHistory() {
	const service = useAtomValue(extensionServiceAtom)
	const [data] = useAtom(taskHistoryDataAtom)
	const [filters] = useAtom(taskHistoryFiltersAtom)
	const [pageIndex] = useAtom(taskHistoryPageIndexAtom)
	const loading = useAtomValue(taskHistoryLoadingAtom)
	const error = useAtomValue(taskHistoryErrorAtom)
	const updateFilters = useSetAtom(updateTaskHistoryFiltersAtom)
	const changePage = useSetAtom(changeTaskHistoryPageAtom)
	const addPendingRequest = useSetAtom(addPendingRequestAtom)
	const removePendingRequest = useSetAtom(removePendingRequestAtom)

	/**
	 * Fetch task history from the extension
	 */
	const fetchTaskHistory = useCallback(async () => {
		if (!service) {
			return
		}

		try {
			// Send task history request to extension
			const payload: TaskHistoryRequestPayload = {
				requestId: Date.now().toString(),
				workspace: filters.workspace,
				sort: filters.sort,
				favoritesOnly: filters.favoritesOnly,
				pageIndex,
			}
			if (filters.search) {
				payload.search = filters.search
			}
			await service.sendWebviewMessage({
				type: "taskHistoryRequest",
				payload,
			})
		} catch (err) {
			logs.error("fetchTaskHistory error:", "useTaskHistory", { error: err })
		}
	}, [service, filters, pageIndex])

	/**
	 * Update filters and fetch new data - returns a Promise that resolves when data arrives
	 */
	const updateFiltersAndFetch = useCallback(
		async (newFilters: Partial<TaskHistoryFilters>): Promise<TaskHistoryData> => {
			if (!service) {
				throw new Error("Extension service not available")
			}

			updateFilters(newFilters)

			// Create a unique request ID
			const requestId = `${Date.now()}-${Math.random()}`

			// Get the updated filters (filters will be reset to page 0 by updateFilters)
			const updatedFilters = { ...filters, ...newFilters }

			// Create a promise that will be resolved when the response arrives
			return new Promise<TaskHistoryData>((resolve, reject) => {
				// Set up timeout (5 seconds)
				const timeout = setTimeout(() => {
					removePendingRequest(requestId)
					reject(new Error("Request timeout - no response received"))
				}, 5000)

				// Store the resolver using the action atom
				addPendingRequest({ requestId, resolve, reject, timeout })

				// Send the request with updated filters
				const payload: TaskHistoryRequestPayload = {
					requestId,
					workspace: updatedFilters.workspace,
					sort: updatedFilters.sort,
					favoritesOnly: updatedFilters.favoritesOnly,
					pageIndex: 0, // Filters reset to page 0
				}
				if (updatedFilters.search) {
					payload.search = updatedFilters.search
				}
				service
					.sendWebviewMessage({
						type: "taskHistoryRequest",
						payload,
					})
					.catch((err) => {
						removePendingRequest(requestId)
						reject(err)
					})
			})
		},
		[updateFilters, service, filters, addPendingRequest, removePendingRequest],
	)

	/**
	 * Change page and fetch new data - returns a Promise that resolves when data arrives
	 */
	const changePageAndFetch = useCallback(
		async (newPageIndex: number): Promise<TaskHistoryData> => {
			if (!service) {
				throw new Error("Extension service not available")
			}

			changePage(newPageIndex)

			// Create a unique request ID
			const requestId = `${Date.now()}-${Math.random()}`

			// Create a promise that will be resolved when the response arrives
			return new Promise<TaskHistoryData>((resolve, reject) => {
				// Set up timeout (5 seconds)
				const timeout = setTimeout(() => {
					removePendingRequest(requestId)
					reject(new Error("Request timeout - no response received"))
				}, 5000)

				// Store the resolver using the action atom
				addPendingRequest({ requestId, resolve, reject, timeout })

				// Send the request
				const payload: TaskHistoryRequestPayload = {
					requestId,
					workspace: filters.workspace,
					sort: filters.sort,
					favoritesOnly: filters.favoritesOnly,
					pageIndex: newPageIndex,
				}
				if (filters.search) {
					payload.search = filters.search
				}
				service
					.sendWebviewMessage({
						type: "taskHistoryRequest",
						payload,
					})
					.catch((err) => {
						removePendingRequest(requestId)
						reject(err)
					})
			})
		},
		[changePage, service, filters, addPendingRequest, removePendingRequest],
	)

	/**
	 * Go to next page
	 */
	const nextPage = useCallback(async (): Promise<TaskHistoryData> => {
		if (data && pageIndex < data.pageCount - 1) {
			return await changePageAndFetch(pageIndex + 1)
		}
		// If already on last page, return current data
		return data || { historyItems: [], pageIndex: 0, pageCount: 0 }
	}, [data, pageIndex, changePageAndFetch])

	/**
	 * Go to previous page
	 */
	const previousPage = useCallback(async (): Promise<TaskHistoryData> => {
		if (pageIndex > 0) {
			return await changePageAndFetch(pageIndex - 1)
		}
		// If already on first page, return current data
		return data || { historyItems: [], pageIndex: 0, pageCount: 0 }
	}, [data, pageIndex, changePageAndFetch])

	return {
		data,
		filters,
		pageIndex,
		loading,
		error,
		fetchTaskHistory,
		updateFilters: updateFiltersAndFetch,
		changePage: changePageAndFetch,
		nextPage,
		previousPage,
	}
}
