// kilocode_change - new file
import { renderHook, act } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { HistoryItem } from "@roo-code/types"
import { useTaskHistory } from "../useTaskHistory"
import type { TaskHistoryResultMessage } from "../../../../src/shared/ExtensionMessage"
import { vscode } from "../../utils/vscode"

vi.mock("../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const getLastRequestId = (): string => {
	const calls = vi.mocked(vscode.postMessage).mock.calls
	if (calls.length === 0) return ""
	const lastCall = calls[calls.length - 1]
	return (lastCall[0] as any).requestId || ""
}

const simulateVSCodeResponse = (response: Omit<TaskHistoryResultMessage, "requestId">, requestId?: string) => {
	const actualRequestId = requestId || getLastRequestId()
	const fullResponse: TaskHistoryResultMessage = {
		...response,
		requestId: actualRequestId,
	}

	const messageEvent = new MessageEvent("message", {
		data: fullResponse,
	})
	window.dispatchEvent(messageEvent)
}

describe("useTaskHistory", () => {
	const mockTasks: HistoryItem[] = [
		{
			id: "task-1",
			number: 1,
			task: "Create a React component",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
			workspace: "/workspace/project1",
		},
		{
			id: "task-2",
			number: 2,
			task: "Write unit tests",
			ts: Date.now() - 1000,
			tokensIn: 200,
			tokensOut: 100,
			totalCost: 0.02,
			workspace: "/workspace/project1",
			isFavorited: true,
		},
		{
			id: "task-3",
			number: 3,
			task: "Fix authentication bug",
			ts: Date.now() - 2000,
			tokensIn: 150,
			tokensOut: 75,
			totalCost: 0.015,
			workspace: "/workspace/project2",
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("sendRequest", () => {
		it("should send correct message for search request", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", { workspace: "/workspace/project1" }, "React")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: "React",
				filters: {
					workspace: "/workspace/project1",
					mode: "search",
				},
			})
		})

		it("should debounce search requests by 300ms", async () => {
			const { result } = renderHook(() => useTaskHistory())

			// Clear the initial auto-load call
			vi.mocked(vscode.postMessage).mockClear()

			act(() => {
				result.current.sendRequest("search", {}, "first")
				result.current.sendRequest("search", {}, "second")
				result.current.sendRequest("search", {}, "third")
			})

			expect(vi.mocked(vscode.postMessage)).not.toHaveBeenCalled()

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledTimes(1)
			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: "third",
				filters: { mode: "search" },
			})
		})
	})

	describe("request correlation", () => {
		it("should ignore outdated responses", async () => {
			const { result } = renderHook(() => useTaskHistory())

			// Clear the initial auto-load call
			vi.mocked(vscode.postMessage).mockClear()

			act(() => {
				result.current.sendRequest("search", {}, "old query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			const firstRequestId = (vi.mocked(vscode.postMessage).mock.calls[0][0] as any).requestId

			act(() => {
				result.current.sendRequest("search", {}, "new query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			const secondRequestId = (vi.mocked(vscode.postMessage).mock.calls[1][0] as any).requestId

			act(() => {
				simulateVSCodeResponse(
					{
						type: "taskHistoryResult",
						taskHistoryData: {
							type: "search",
							tasks: mockTasks,
							totalCount: 3,
							favoriteCount: 1,
						},
					},
					secondRequestId,
				)
			})

			act(() => {
				simulateVSCodeResponse(
					{
						type: "taskHistoryResult",
						taskHistoryData: {
							type: "search",
							tasks: [],
							totalCount: 0,
							favoriteCount: 0,
						},
					},
					firstRequestId,
				)
			})

			expect(result.current.tasks).toEqual(mockTasks)
			expect(result.current.totalCount).toBe(3)
		})
	})

	describe("mode switching", () => {
		it("should update mode state correctly", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.isSearchMode).toBe(true)
			expect(result.current.isFavoritesMode).toBe(false)
		})

		it("should provide correct derived data for each mode", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.searchResults).toEqual(mockTasks)
			expect(result.current.isSearching).toBe(false)
			expect(result.current.favoriteTasks).toEqual([])

			act(() => {
				result.current.sendRequest("favorites", {})
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "favorites",
						tasks: [mockTasks[1]],
						totalCount: 1,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.favoriteTasks).toEqual([mockTasks[1]])
			expect(result.current.isFetchingFavorites).toBe(false)
			expect(result.current.searchResults).toEqual([])
		})
	})

	describe("error handling", () => {
		it("should handle request errors gracefully", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						error: "Network error",
						totalCount: 0,
						favoriteCount: 0,
					},
				})
			})

			expect(result.current.loading).toBe(false)
			expect(result.current.error).toBe("Network error")
			expect(result.current.tasks).toEqual([])
		})

		it("should handle server errors in response", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						error: "Server error occurred",
						totalCount: 0,
						favoriteCount: 0,
					},
				})
			})

			expect(result.current.loading).toBe(false)
			expect(result.current.error).toBe("Server error occurred")
			expect(result.current.tasks).toEqual([])
		})

		it("should handle missing data in response", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: undefined as any,
				})
			})

			expect(result.current.loading).toBe(false)
			expect(result.current.error).toBe("No data received from server")
		})
	})

	describe("loading states", () => {
		it("should set loading state during requests", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(result.current.loading).toBe(true)
			expect(result.current.error).toBe(null)

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.loading).toBe(false)
		})

		it("should provide correct loading states for different modes", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(result.current.isSearching).toBe(true)
			expect(result.current.isFetchingFavorites).toBe(false)
			expect(result.current.isFetchingPage).toBe(false)

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.isSearching).toBe(false)

			act(() => {
				result.current.sendRequest("favorites", {})
			})

			expect(result.current.isFetchingFavorites).toBe(true)
			expect(result.current.isSearching).toBe(false)

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "favorites",
						tasks: [mockTasks[1]],
						totalCount: 1,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.isFetchingFavorites).toBe(false)
		})
	})

	describe("backward compatibility methods", () => {
		it("should provide searchTasks method", async () => {
			const { result } = renderHook(() => useTaskHistory())

			await act(async () => {
				await result.current.searchTasks("React", { workspace: "/workspace/project1" })
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: "React",
				filters: {
					workspace: "/workspace/project1",
					mode: "search",
				},
			})
		})

		it("should provide getFavoriteTasks method", async () => {
			const { result } = renderHook(() => useTaskHistory())

			await act(async () => {
				await result.current.getFavoriteTasks("/workspace/project1")
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: undefined,
				filters: {
					workspace: "/workspace/project1",
					mode: "favorites",
				},
			})
		})

		it("should provide getTaskPage method", async () => {
			const { result } = renderHook(() => useTaskHistory())

			await act(async () => {
				await result.current.getTaskPage(1, 10, { workspace: "/workspace/project1" })
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: undefined,
				filters: {
					workspace: "/workspace/project1",
					page: 1,
					limit: 10,
					mode: "page",
				},
			})
		})

		it("should provide getPromptHistory method", async () => {
			const { result } = renderHook(() => useTaskHistory())

			await act(async () => {
				await result.current.getPromptHistory("/workspace/project1")
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "getTaskHistory",
				requestId: expect.any(String),
				query: undefined,
				filters: {
					workspace: "/workspace/project1",
					mode: "promptHistory",
				},
			})
		})

		it("should provide toggleTaskFavorite method", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			await act(async () => {
				await result.current.toggleTaskFavorite("task-1")
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "toggleTaskFavorite",
				text: "task-1",
			})
		})
	})

	describe("optimistic updates", () => {
		it("should optimistically update favorite status", async () => {
			const { result } = renderHook(() => useTaskHistory())

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			act(() => {
				vi.advanceTimersByTime(300)
			})

			act(() => {
				simulateVSCodeResponse({
					type: "taskHistoryResult",
					taskHistoryData: {
						type: "search",
						tasks: mockTasks,
						totalCount: 3,
						favoriteCount: 1,
					},
				})
			})

			expect(result.current.tasks[0].isFavorited).toBeFalsy()

			act(() => {
				result.current.toggleFavorite("task-1")
			})

			expect(vi.mocked(vscode.postMessage)).toHaveBeenCalledWith({
				type: "toggleTaskFavorite",
				text: "task-1",
			})

			expect(result.current.tasks[0].isFavorited).toBe(true)
		})
	})

	describe("cleanup", () => {
		it("should cleanup debounce timeout on unmount", () => {
			const { result, unmount } = renderHook(() => useTaskHistory())

			// Clear the initial auto-load call
			vi.mocked(vscode.postMessage).mockClear()

			act(() => {
				result.current.sendRequest("search", {}, "query")
			})

			unmount()

			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(vi.mocked(vscode.postMessage)).not.toHaveBeenCalled()
		})
	})
})
