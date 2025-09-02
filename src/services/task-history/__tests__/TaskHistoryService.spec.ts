import { TaskHistoryService, SearchOptions, SearchResult, PaginatedResult } from "../TaskHistoryService"
import { HistoryItem } from "@roo-code/types"

describe("TaskHistoryService", () => {
	let service: TaskHistoryService
	let mockTasks: HistoryItem[]

	beforeEach(() => {
		// Create mock task history data
		mockTasks = [
			{
				id: "1",
				number: 1,
				ts: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
				task: "Create a React component",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.01,
				workspace: "/path/to/project1",
				isFavorited: true,
				mode: "code",
			},
			{
				id: "2",
				number: 2,
				ts: Date.now() - 1000 * 60 * 60 * 12, // 12 hours ago
				task: "Fix bug in authentication",
				tokensIn: 150,
				tokensOut: 300,
				totalCost: 0.02,
				workspace: "/path/to/project2",
				isFavorited: false,
				mode: "debug",
			},
			{
				id: "3",
				number: 3,
				ts: Date.now() - 1000 * 60 * 60 * 6, // 6 hours ago
				task: "Write unit tests",
				tokensIn: 200,
				tokensOut: 400,
				totalCost: 0.03,
				workspace: "/path/to/project1",
				isFavorited: true,
				mode: "test",
			},
			{
				id: "4",
				number: 4,
				ts: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
				task: "Refactor database queries",
				tokensIn: 250,
				tokensOut: 500,
				totalCost: 0.04,
				workspace: "/path/to/project2",
				isFavorited: false,
				mode: "code",
			},
			{
				id: "5",
				number: 5,
				ts: Date.now() - 1000 * 60 * 30, // 30 minutes ago
				task: "Update documentation",
				tokensIn: 80,
				tokensOut: 160,
				totalCost: 0.005,
				workspace: "/path/to/project1",
				isFavorited: false,
				mode: "architect",
			},
		]

		service = new TaskHistoryService(mockTasks)
	})

	describe("getRecentTasks", () => {
		it("should return recent tasks sorted by date (newest first)", () => {
			const result = service.getRecentTasks(3)

			expect(result).toHaveLength(3)
			expect(result[0].id).toBe("5") // Most recent
			expect(result[1].id).toBe("4")
			expect(result[2].id).toBe("3")
		})

		it("should return all tasks when limit exceeds total count", () => {
			const result = service.getRecentTasks(10)

			expect(result).toHaveLength(5)
			expect(result[0].id).toBe("5") // Most recent
		})

		it("should return empty array for zero or negative limit", () => {
			expect(service.getRecentTasks(0)).toEqual([])
			expect(service.getRecentTasks(-1)).toEqual([])
		})

		it("should use default limit of 10", () => {
			const result = service.getRecentTasks()
			expect(result).toHaveLength(5) // All tasks since we have less than 10
		})
	})

	describe("searchTasks", () => {
		it("should return all tasks when query is empty", () => {
			const result = service.searchTasks("")

			expect(result.tasks).toHaveLength(5)
			expect(result.totalCount).toBe(5)
			expect(result.hasMore).toBe(false)
		})

		it("should find tasks by exact task name match", () => {
			const result = service.searchTasks("React component")

			expect(result.tasks).toHaveLength(1)
			expect(result.tasks[0].id).toBe("1")
			expect(result.totalCount).toBe(1)
		})

		it("should find tasks by partial match", () => {
			const result = service.searchTasks("bug")

			expect(result.tasks).toHaveLength(1)
			expect(result.tasks[0].id).toBe("2")
		})

		it("should find tasks by workspace", () => {
			const result = service.searchTasks("project1")

			expect(result.tasks).toHaveLength(3)
			expect(result.tasks.every((task) => task.workspace === "/path/to/project1")).toBe(true)
		})

		it("should find tasks by mode", () => {
			const result = service.searchTasks("code")

			expect(result.tasks).toHaveLength(2)
			expect(result.tasks.every((task) => task.mode === "code")).toBe(true)
		})

		it("should handle fuzzy matching for typos", () => {
			const result = service.searchTasks("Reakt") // Typo in "React"

			expect(result.tasks).toHaveLength(1)
			expect(result.tasks[0].id).toBe("1")
		})

		it("should return empty results for non-matching query", () => {
			const result = service.searchTasks("nonexistent")

			expect(result.tasks).toHaveLength(0)
			expect(result.totalCount).toBe(0)
		})

		it("should handle multiple search terms", () => {
			const result = service.searchTasks("unit tests")

			expect(result.tasks).toHaveLength(1)
			expect(result.tasks[0].id).toBe("3")
		})
	})

	describe("searchTasks with options", () => {
		it("should filter by workspace", () => {
			const options: SearchOptions = { workspace: "/path/to/project1" }
			const result = service.searchTasks("", options)

			expect(result.tasks).toHaveLength(3)
			expect(result.tasks.every((task) => task.workspace === "/path/to/project1")).toBe(true)
		})

		it("should filter by favorites only", () => {
			const options: SearchOptions = { favoritesOnly: true }
			const result = service.searchTasks("", options)

			expect(result.tasks).toHaveLength(2)
			expect(result.tasks.every((task) => task.isFavorited === true)).toBe(true)
		})

		it("should sort by name", () => {
			const options: SearchOptions = { sortBy: "name" }
			const result = service.searchTasks("", options)

			expect(result.tasks[0].task).toBe("Create a React component")
			expect(result.tasks[1].task).toBe("Fix bug in authentication")
		})

		it("should sort by workspace", () => {
			const options: SearchOptions = { sortBy: "workspace" }
			const result = service.searchTasks("", options)

			// Should group by workspace, then by date within workspace
			const project1Tasks = result.tasks.filter((t) => t.workspace === "/path/to/project1")
			const project2Tasks = result.tasks.filter((t) => t.workspace === "/path/to/project2")

			expect(project1Tasks).toHaveLength(3)
			expect(project2Tasks).toHaveLength(2)
		})

		it("should filter by date range", () => {
			const now = new Date()
			const threeDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3)
			const oneHourAgo = new Date(now.getTime() - 1000 * 60 * 60)

			const options: SearchOptions = {
				dateRange: { start: threeDaysAgo, end: oneHourAgo },
			}
			const result = service.searchTasks("", options)

			expect(result.tasks.length).toBeGreaterThan(0)
			result.tasks.forEach((task) => {
				expect(task.ts).toBeGreaterThanOrEqual(threeDaysAgo.getTime())
				expect(task.ts).toBeLessThanOrEqual(oneHourAgo.getTime())
			})
		})

		it("should combine multiple filters", () => {
			const options: SearchOptions = {
				workspace: "/path/to/project1",
				favoritesOnly: true,
				sortBy: "name",
			}
			const result = service.searchTasks("", options)

			expect(result.tasks).toHaveLength(2)
			expect(
				result.tasks.every((task) => task.workspace === "/path/to/project1" && task.isFavorited === true),
			).toBe(true)
		})
	})

	describe("getFavoriteTasks", () => {
		it("should return all favorited tasks", () => {
			const result = service.getFavoriteTasks()

			expect(result).toHaveLength(2)
			expect(result.every((task) => task.isFavorited === true)).toBe(true)
		})

		it("should filter favorited tasks by workspace", () => {
			const result = service.getFavoriteTasks({ workspace: "/path/to/project1" })

			expect(result).toHaveLength(2)
			expect(result.every((task) => task.isFavorited === true && task.workspace === "/path/to/project1")).toBe(
				true,
			)
		})

		it("should return empty array when no favorites exist for workspace", () => {
			const result = service.getFavoriteTasks({ workspace: "/nonexistent" })

			expect(result).toEqual([])
		})
	})

	describe("filterByWorkspace", () => {
		it("should return tasks for specific workspace", () => {
			const result = service.filterByWorkspace("/path/to/project1")

			expect(result).toHaveLength(3)
			expect(result.every((task) => task.workspace === "/path/to/project1")).toBe(true)
		})

		it("should return all tasks for empty workspace", () => {
			const result = service.filterByWorkspace("")

			expect(result).toHaveLength(5)
		})

		it("should return empty array for non-existent workspace", () => {
			const result = service.filterByWorkspace("/nonexistent")

			expect(result).toEqual([])
		})
	})

	describe("filterByDateRange", () => {
		it("should return tasks within date range", () => {
			const now = new Date()
			const oneDayAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24)
			const oneHourAgo = new Date(now.getTime() - 1000 * 60 * 60)

			const result = service.filterByDateRange(oneDayAgo, oneHourAgo)

			expect(result.length).toBeGreaterThan(0)
			result.forEach((task) => {
				expect(task.ts).toBeGreaterThanOrEqual(oneDayAgo.getTime())
				expect(task.ts).toBeLessThanOrEqual(oneHourAgo.getTime())
			})
		})

		it("should return empty array for invalid date range", () => {
			const now = new Date()
			const oneDayAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24)

			// End date before start date
			const result = service.filterByDateRange(now, oneDayAgo)

			expect(result).toEqual([])
		})

		it("should handle null dates", () => {
			const result = service.filterByDateRange(null as any, null as any)

			expect(result).toEqual([])
		})
	})

	describe("sortTasks", () => {
		it("should sort by date (newest first)", () => {
			const result = service.sortTasks(mockTasks, "date")

			expect(result[0].id).toBe("5") // Most recent
			expect(result[4].id).toBe("1") // Oldest

			// Verify descending order
			for (let i = 0; i < result.length - 1; i++) {
				expect(result[i].ts).toBeGreaterThanOrEqual(result[i + 1].ts)
			}
		})

		it("should sort by name alphabetically", () => {
			const result = service.sortTasks(mockTasks, "name")

			expect(result[0].task).toBe("Create a React component")
			expect(result[1].task).toBe("Fix bug in authentication")
			expect(result[2].task).toBe("Refactor database queries")
			expect(result[3].task).toBe("Update documentation")
			expect(result[4].task).toBe("Write unit tests")
		})

		it("should sort by workspace with secondary date sort", () => {
			const result = service.sortTasks(mockTasks, "workspace")

			// Should group by workspace
			const workspaces = result.map((task) => task.workspace)
			const uniqueWorkspaces = [...new Set(workspaces)]

			expect(uniqueWorkspaces).toHaveLength(2)

			// Within each workspace, should be sorted by date (newest first)
			let currentWorkspace = ""
			let lastTimestamp = Infinity

			result.forEach((task) => {
				if (task.workspace !== currentWorkspace) {
					currentWorkspace = task.workspace || ""
					lastTimestamp = Infinity
				}
				expect(task.ts).toBeLessThanOrEqual(lastTimestamp)
				lastTimestamp = task.ts
			})
		})

		it("should not modify original array", () => {
			const originalLength = mockTasks.length
			const originalFirstId = mockTasks[0].id

			service.sortTasks(mockTasks, "name")

			expect(mockTasks).toHaveLength(originalLength)
			expect(mockTasks[0].id).toBe(originalFirstId)
		})
	})

	describe("getTaskPage", () => {
		it("should return correct page with pagination info", () => {
			const result = service.getTaskPage(1, 2)

			expect(result.tasks).toHaveLength(2)
			expect(result.pageNumber).toBe(1)
			expect(result.totalPages).toBe(3) // 5 tasks / 2 per page = 3 pages
			expect(result.hasMore).toBe(true)
		})

		it("should return last page correctly", () => {
			const result = service.getTaskPage(3, 2)

			expect(result.tasks).toHaveLength(1) // Last page has 1 task
			expect(result.pageNumber).toBe(3)
			expect(result.totalPages).toBe(3)
			expect(result.hasMore).toBe(false)
		})

		it("should handle page beyond total pages", () => {
			const result = service.getTaskPage(10, 2)

			expect(result.tasks).toHaveLength(0)
			expect(result.pageNumber).toBe(10)
			expect(result.totalPages).toBe(3)
			expect(result.hasMore).toBe(false)
		})

		it("should handle invalid page numbers", () => {
			const result = service.getTaskPage(0, 2)

			expect(result.tasks).toEqual([])
			expect(result.pageNumber).toBe(0)
			expect(result.totalPages).toBe(0)
			expect(result.hasMore).toBe(false)
		})

		it("should handle invalid limit", () => {
			const result = service.getTaskPage(1, 0)

			expect(result.tasks).toEqual([])
			expect(result.pageNumber).toBe(1)
			expect(result.totalPages).toBe(0)
			expect(result.hasMore).toBe(false)
		})

		it("should apply filters before pagination", () => {
			const filters: SearchOptions = { workspace: "/path/to/project1" }
			const result = service.getTaskPage(1, 2, filters)

			expect(result.tasks).toHaveLength(2)
			expect(result.totalPages).toBe(2) // 3 filtered tasks / 2 per page = 2 pages
			expect(result.tasks.every((task) => task.workspace === "/path/to/project1")).toBe(true)
		})
	})

	describe("getPromptHistory", () => {
		it("should return unique prompts for workspace", () => {
			const result = service.getPromptHistory("/path/to/project1", 10)

			expect(result).toHaveLength(3)
			expect(result).toContain("Update documentation")
			expect(result).toContain("Write unit tests")
			expect(result).toContain("Create a React component")
		})

		it("should limit results correctly", () => {
			const result = service.getPromptHistory("/path/to/project1", 2)

			expect(result).toHaveLength(2)
		})

		it("should return empty array for non-existent workspace", () => {
			const result = service.getPromptHistory("/nonexistent", 10)

			expect(result).toEqual([])
		})

		it("should return empty array for empty workspace", () => {
			const result = service.getPromptHistory("", 10)

			expect(result).toEqual([])
		})

		it("should return empty array for zero or negative limit", () => {
			expect(service.getPromptHistory("/path/to/project1", 0)).toEqual([])
			expect(service.getPromptHistory("/path/to/project1", -1)).toEqual([])
		})

		it("should return prompts in chronological order (newest first)", () => {
			const result = service.getPromptHistory("/path/to/project1", 10)

			expect(result[0]).toBe("Update documentation") // Most recent
			expect(result[1]).toBe("Write unit tests")
			expect(result[2]).toBe("Create a React component") // Oldest
		})
	})

	describe("getTaskById", () => {
		it("should return task when ID exists", () => {
			const result = service.getTaskById("1")
			expect(result).toBeDefined()
			expect(result?.id).toBe("1")
			expect(result?.task).toBe("Create a React component")
		})

		it("should return undefined when ID does not exist", () => {
			const result = service.getTaskById("non-existent-id")
			expect(result).toBeUndefined()
		})

		it("should return undefined for empty or null ID", () => {
			expect(service.getTaskById("")).toBeUndefined()
			expect(service.getTaskById(null as any)).toBeUndefined()
			expect(service.getTaskById(undefined as any)).toBeUndefined()
		})

		it("should handle special characters in ID", () => {
			const specialTask: HistoryItem = {
				id: "task-with-special-chars-@#$%",
				number: 99,
				ts: Date.now(),
				task: "Special task",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.01,
				workspace: "/test/workspace",
				isFavorited: false,
				mode: "code",
			}

			const serviceWithSpecial = new TaskHistoryService([...mockTasks, specialTask])
			const result = serviceWithSpecial.getTaskById("task-with-special-chars-@#$%")
			expect(result).toBeDefined()
			expect(result?.task).toBe("Special task")
		})
	})

	describe("edge cases", () => {
		it("should handle empty task history", () => {
			const emptyService = new TaskHistoryService([])

			expect(emptyService.getRecentTasks()).toEqual([])
			expect(emptyService.searchTasks("test")).toEqual({
				tasks: [],
				totalCount: 0,
				hasMore: false,
			})
			expect(emptyService.getFavoriteTasks()).toEqual([])
			expect(emptyService.getPromptHistory("/any", 10)).toEqual([])
		})

		it("should handle tasks with missing optional fields", () => {
			const minimalTasks: HistoryItem[] = [
				{
					id: "1",
					number: 1,
					ts: Date.now(),
					task: "Minimal task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.01,
					// No workspace, isFavorited, mode
				},
			]

			const minimalService = new TaskHistoryService(minimalTasks)

			expect(minimalService.getRecentTasks()).toHaveLength(1)
			expect(minimalService.filterByWorkspace("")).toHaveLength(1)
			expect(minimalService.getFavoriteTasks()).toEqual([])
		})

		it("should handle null and undefined values gracefully", () => {
			const tasksWithNulls: HistoryItem[] = [
				{
					id: "1",
					number: 1,
					ts: Date.now(),
					task: "",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.01,
					workspace: undefined,
					isFavorited: undefined,
					mode: undefined,
				},
			]

			const serviceWithNulls = new TaskHistoryService(tasksWithNulls)

			expect(() => {
				serviceWithNulls.getRecentTasks()
				serviceWithNulls.searchTasks("test")
				serviceWithNulls.sortTasks(tasksWithNulls, "workspace")
			}).not.toThrow()
		})
	})
})
