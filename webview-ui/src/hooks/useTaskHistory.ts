import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { HistoryItem } from "@roo-code/types"
import { vscode } from "../utils/vscode"
import type { TaskHistoryResultMessage, ExtensionMessage } from "../../../src/shared/ExtensionMessage"
import type { TaskHistoryFilters, TaskHistoryMode } from "../../../src/shared/TaskHistoryTypes"
import type { GetTaskHistoryMessage } from "../../../src/shared/WebviewMessage"

interface TaskHistoryState {
	loading: boolean
	error: string | null
	tasks: HistoryItem[]
	totalCount: number // Single source, not nested
	favoriteCount: number // Single source, not nested
	hasMore: boolean
	pageNumber: number
	totalPages: number
	promptHistory: string[]
}

export interface TaskHistoryAPI {
	loading: boolean
	error: string | null
	tasks: HistoryItem[]
	totalCount: number
	favoriteCount: number // Added favoriteCount to API
	hasMore: boolean
	pageNumber: number
	totalPages: number
	promptHistory: string[]

	sendRequest: (mode: TaskHistoryMode, filters: TaskHistoryFilters, query?: string) => void
	toggleFavorite: (taskId: string) => void

	visibleTasks: HistoryItem[]
	isSearchMode: boolean
	isFavoritesMode: boolean
	canLoadMore: boolean

	searchTasks: (query: string, filters?: TaskHistoryFilters) => Promise<void>
	searchResults: HistoryItem[]
	isSearching: boolean
	searchError: string | null
	getFavoriteTasks: (workspace?: string) => Promise<void>
	favoriteTasks: HistoryItem[]
	isFetchingFavorites: boolean
	favoritesError: string | null
	getTaskPage: (page: number, limit?: number, filters?: TaskHistoryFilters) => Promise<void>
	taskPages: Record<number, HistoryItem[]>
	isFetchingPage: boolean
	pageError: string | null
	getPromptHistory: (workspace: string) => Promise<void>
	isFetchingPrompts: boolean
	promptsError: string | null
	toggleTaskFavorite: (taskId: string) => Promise<void>
}

const generateRequestId = (): string => {
	return Date.now().toString()
}

export function useTaskHistory(): TaskHistoryAPI {
	const [state, setState] = useState<TaskHistoryState>({
		loading: false,
		error: null,
		tasks: [],
		totalCount: 0,
		favoriteCount: 0,
		hasMore: false,
		pageNumber: 1,
		totalPages: 1,
		promptHistory: [],
	})

	const [_currentRequestId, setCurrentRequestId] = useState<string>("")
	const [currentMode, setCurrentMode] = useState<TaskHistoryMode | null>(null)
	const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const cleanupRef = useRef<(() => void) | null>(null)
	const hasInitializedRef = useRef<boolean>(false)

	const clearDebounceTimeout = useCallback(() => {
		if (debounceTimeoutRef.current) {
			clearTimeout(debounceTimeoutRef.current)
			debounceTimeoutRef.current = null
		}
	}, [])

	const executeRequest = useCallback(async (mode: TaskHistoryMode, filters: TaskHistoryFilters, query?: string) => {
		const requestId = generateRequestId()

		// Clean up any previous request
		if (cleanupRef.current) {
			cleanupRef.current()
			cleanupRef.current = null
		}

		// Set the new request ID and mode in a single update
		setCurrentRequestId(requestId)
		setCurrentMode(mode)

		setState((prev) => ({ ...prev, loading: true, error: null }))

		const cleanup = () => {
			window.removeEventListener("message", handler)
			cleanupRef.current = null
		}

		cleanupRef.current = cleanup

		const timeout = setTimeout(() => {
			cleanup()
			// Only update state if this is still the current request
			setCurrentRequestId((currentId) => {
				if (currentId === requestId) {
					setState((prev) => ({
						...prev,
						loading: false,
						error: "Request timed out",
					}))
					return ""
				}
				return currentId
			})
		}, 30000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "taskHistoryResult" && message.requestId === requestId) {
				console.log("[useTaskHistory] Received taskHistoryResult:", {
					requestId,
					mode,
					filters,
					query,
					taskHistoryData: message.taskHistoryData,
				})

				clearTimeout(timeout)
				cleanup()

				// Check if this request is still current before processing
				setCurrentRequestId((currentId) => {
					if (currentId === requestId) {
						const { taskHistoryData } = message as TaskHistoryResultMessage

						if (!taskHistoryData) {
							console.log("[useTaskHistory] No taskHistoryData received")
							setState((prev) => ({
								...prev,
								loading: false,
								error: "No data received from server",
							}))
							return ""
						}

						if (taskHistoryData.error) {
							console.log("[useTaskHistory] Error in taskHistoryData:", taskHistoryData.error)
							setState((prev) => ({
								...prev,
								loading: false,
								error: taskHistoryData.error || "Unknown error occurred",
							}))
							return ""
						}

						console.log("[useTaskHistory] Processing successful response:", {
							tasksCount: taskHistoryData.tasks?.length || 0,
							totalCount: taskHistoryData.totalCount,
							favoriteCount: taskHistoryData.favoriteCount,
							tasks: taskHistoryData.tasks,
						})

						setState((prev) => ({
							...prev,
							loading: false,
							error: null,
							tasks: taskHistoryData.tasks || [],
							totalCount: taskHistoryData.totalCount || 0,
							favoriteCount: taskHistoryData.favoriteCount || 0,
							hasMore: taskHistoryData.hasMore || false,
							pageNumber: taskHistoryData.pageNumber || 1,
							totalPages: taskHistoryData.totalPages || 1,
							promptHistory: taskHistoryData.promptHistory || [],
						}))
						return ""
					}
					// If this is not the current request, ignore it completely
					return currentId
				})
			}
		}

		window.addEventListener("message", handler)
		const message: GetTaskHistoryMessage = {
			type: "getTaskHistory",
			requestId,
			query,
			filters: { ...filters, mode },
		}
		vscode.postMessage(message)
	}, [])

	const sendRequest = useCallback(
		(mode: TaskHistoryMode, filters: TaskHistoryFilters, query?: string) => {
			clearDebounceTimeout()

			if (mode === "search" && query !== undefined) {
				// Debounce search requests to prevent excessive API calls
				debounceTimeoutRef.current = setTimeout(() => {
					executeRequest(mode, filters, query)
				}, 300)
			} else {
				executeRequest(mode, filters, query)
			}
		},
		[executeRequest, clearDebounceTimeout],
	)

	const toggleFavorite = useCallback((taskId: string) => {
		// Optimistic update for immediate UI feedback
		setState((prev) => ({
			...prev,
			tasks: prev.tasks.map((task) => (task.id === taskId ? { ...task, isFavorited: !task.isFavorited } : task)),
		}))

		vscode.postMessage({ type: "toggleTaskFavorite", text: taskId })
	}, [])

	// Auto-load initial task history data on mount
	useEffect(() => {
		if (!hasInitializedRef.current) {
			hasInitializedRef.current = true
			console.log("[useTaskHistory] Auto-loading initial task history data")
			// Load first page of tasks to get actual data
			executeRequest("page", { page: 1, limit: 20 })
		}
	}, [executeRequest])

	useEffect(() => {
		return () => {
			clearDebounceTimeout()
		}
	}, [clearDebounceTimeout])

	const derivedState = useMemo(() => {
		const isSearchMode = currentMode === "search"
		const isFavoritesMode = currentMode === "favorites"

		return {
			visibleTasks: state.tasks,
			isSearchMode,
			isFavoritesMode,
			canLoadMore: state.hasMore && !state.loading,
		}
	}, [state.tasks, state.hasMore, state.loading, currentMode])

	const searchTasks = useCallback(
		async (query: string, filters: TaskHistoryFilters = {}) => {
			sendRequest("search", filters, query)
		},
		[sendRequest],
	)

	const getFavoriteTasks = useCallback(
		async (workspace?: string) => {
			sendRequest("favorites", { workspace })
		},
		[sendRequest],
	)

	const getTaskPage = useCallback(
		async (page: number, limit = 20, filters: TaskHistoryFilters = {}) => {
			sendRequest("page", { ...filters, page, limit })
		},
		[sendRequest],
	)

	const getPromptHistory = useCallback(
		async (workspace: string) => {
			sendRequest("promptHistory", { workspace })
		},
		[sendRequest],
	)

	const toggleTaskFavorite = useCallback(
		async (taskId: string) => {
			toggleFavorite(taskId)
		},
		[toggleFavorite],
	)

	const backwardCompatState = useMemo(() => {
		const isSearching = state.loading && currentMode === "search"
		const isFetchingFavorites = state.loading && currentMode === "favorites"
		const isFetchingPage = state.loading && currentMode === "page"
		const isFetchingPrompts = state.loading && currentMode === "promptHistory"

		return {
			searchResults: currentMode === "search" ? state.tasks : [],
			isSearching,
			searchError: currentMode === "search" ? state.error : null,
			favoriteTasks: currentMode === "favorites" ? state.tasks : [],
			isFetchingFavorites,
			favoritesError: currentMode === "favorites" ? state.error : null,
			taskPages: currentMode === "page" ? { [state.pageNumber]: state.tasks } : {},
			isFetchingPage,
			pageError: currentMode === "page" ? state.error : null,
			isFetchingPrompts,
			promptsError: currentMode === "promptHistory" ? state.error : null,
		}
	}, [state, currentMode])

	return {
		...state,
		sendRequest,
		toggleFavorite,
		...derivedState,
		searchTasks,
		getFavoriteTasks,
		getTaskPage,
		getPromptHistory,
		toggleTaskFavorite,
		...backwardCompatState,
	}
}
