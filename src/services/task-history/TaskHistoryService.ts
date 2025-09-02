import { HistoryItem } from "@roo-code/types"

export interface SearchOptions {
	workspace?: string
	favoritesOnly?: boolean
	sortBy?: "date" | "name" | "workspace"
	dateRange?: { start: Date; end: Date }
}

export interface SearchResult {
	tasks: HistoryItem[]
	totalCount: number
	hasMore: boolean
}

export interface PaginatedResult {
	tasks: HistoryItem[]
	pageNumber: number
	totalPages: number
	hasMore: boolean
}

export class TaskHistoryService {
	constructor(private taskHistory: HistoryItem[]) {}

	/**
	 * Get the most recent tasks, limited by count
	 */
	getRecentTasks(limit: number = 10): HistoryItem[] {
		if (limit <= 0) return []

		return this.sortTasks([...this.taskHistory], "date").slice(0, limit)
	}

	/**
	 * Search tasks with fuzzy matching and filtering options
	 */
	searchTasks(query: string, options: SearchOptions = {}): SearchResult {
		if (!query.trim()) {
			const filtered = this.applyFilters(this.taskHistory, options)
			const sorted = this.sortTasks(filtered, options.sortBy || "date")
			return {
				tasks: sorted,
				totalCount: sorted.length,
				hasMore: false,
			}
		}

		const matchingTasks = this.taskHistory.filter((task) => this.matchesQuery(task, query.trim()))

		const filtered = this.applyFilters(matchingTasks, options)
		const sorted = this.sortTasks(filtered, options.sortBy || "date")

		return {
			tasks: sorted,
			totalCount: sorted.length,
			hasMore: false,
		}
	}

	/**
	 * Get all favorited tasks with optional workspace filtering
	 */
	getFavoriteTasks(options?: { workspace?: string }): HistoryItem[] {
		let favorites = this.taskHistory.filter((task) => task.isFavorited === true)

		if (options?.workspace) {
			favorites = favorites.filter((task) => task.workspace === options.workspace)
		}

		return this.sortTasks(favorites, "date")
	}

	/**
	 * Filter tasks by workspace
	 */
	filterByWorkspace(workspace: string): HistoryItem[] {
		if (!workspace.trim()) return [...this.taskHistory]

		return this.taskHistory.filter((task) => task.workspace === workspace)
	}

	/**
	 * Filter tasks by date range (inclusive)
	 */
	filterByDateRange(start: Date, end: Date): HistoryItem[] {
		if (!start || !end || start > end) return []

		const startTime = start.getTime()
		const endTime = end.getTime()

		return this.taskHistory.filter((task) => {
			const taskTime = task.ts
			return taskTime >= startTime && taskTime <= endTime
		})
	}

	/**
	 * Sort tasks by specified criteria
	 */
	sortTasks(tasks: HistoryItem[], sortBy: "date" | "name" | "workspace"): HistoryItem[] {
		const tasksCopy = [...tasks]

		switch (sortBy) {
			case "date":
				return tasksCopy.sort((a, b) => b.ts - a.ts) // Newest first

			case "name":
				return tasksCopy.sort((a, b) => {
					const nameA = a.task.toLowerCase()
					const nameB = b.task.toLowerCase()
					return nameA.localeCompare(nameB)
				})

			case "workspace":
				return tasksCopy.sort((a, b) => {
					const workspaceA = (a.workspace || "").toLowerCase()
					const workspaceB = (b.workspace || "").toLowerCase()
					if (workspaceA === workspaceB) {
						return b.ts - a.ts // Secondary sort by date
					}
					return workspaceA.localeCompare(workspaceB)
				})

			default:
				return tasksCopy
		}
	}

	/**
	 * Get paginated tasks with filtering and sorting
	 */
	getTaskPage(page: number, limit: number = 10, filters?: SearchOptions): PaginatedResult {
		if (page < 1 || limit <= 0) {
			return {
				tasks: [],
				pageNumber: page,
				totalPages: 0,
				hasMore: false,
			}
		}

		const filtered = filters ? this.applyFilters(this.taskHistory, filters) : [...this.taskHistory]
		const sorted = this.sortTasks(filtered, filters?.sortBy || "date")

		const totalCount = sorted.length
		const totalPages = Math.ceil(totalCount / limit)
		const startIndex = (page - 1) * limit
		const endIndex = startIndex + limit

		const tasks = sorted.slice(startIndex, endIndex)
		const hasMore = page < totalPages

		return {
			tasks,
			pageNumber: page,
			totalPages,
			hasMore,
		}
	}

	/**
	 * Get a single task by its ID
	 */
	getTaskById(id: string): HistoryItem | undefined {
		return this.taskHistory.find((task) => task.id === id)
	}

	/**
	 * Get unique prompts from task history for a specific workspace
	 */
	getPromptHistory(workspace: string, limit: number = 20): string[] {
		if (!workspace.trim() || limit <= 0) return []

		const workspaceTasks = this.filterByWorkspace(workspace)
		const sortedTasks = this.sortTasks(workspaceTasks, "date")

		const uniquePrompts = new Set<string>()
		const prompts: string[] = []

		for (const task of sortedTasks) {
			if (task.task && !uniquePrompts.has(task.task)) {
				uniquePrompts.add(task.task)
				prompts.push(task.task)

				if (prompts.length >= limit) break
			}
		}

		return prompts
	}

	/**
	 * Check if a task matches the search query using fuzzy matching
	 */
	private matchesQuery(task: HistoryItem, query: string): boolean {
		if (!query) return true

		const searchTerms = query
			.toLowerCase()
			.split(/\s+/)
			.filter((term) => term.length > 0)
		if (searchTerms.length === 0) return true

		const searchableText = [task.task || "", task.workspace || "", task.mode || ""].join(" ").toLowerCase()

		// All search terms must be found somewhere in the searchable text
		return searchTerms.every((term) => {
			// Exact match
			if (searchableText.includes(term)) return true

			// Fuzzy match - allow for minor typos (simple character substitution)
			const words = searchableText.split(/\s+/)
			return words.some((word) => {
				if (word.length < 3 || term.length < 3) return false

				// Allow one character difference for words of similar length
				if (Math.abs(word.length - term.length) <= 1) {
					let differences = 0
					const minLength = Math.min(word.length, term.length)

					for (let i = 0; i < minLength; i++) {
						if (word[i] !== term[i]) differences++
						if (differences > 1) return false
					}

					return differences <= 1
				}

				return false
			})
		})
	}

	/**
	 * Apply filtering options to a list of tasks
	 */
	private applyFilters(tasks: HistoryItem[], options: SearchOptions): HistoryItem[] {
		let filtered = [...tasks]

		// Filter by workspace
		if (options.workspace) {
			filtered = filtered.filter((task) => task.workspace === options.workspace)
		}

		// Filter by favorites
		if (options.favoritesOnly) {
			filtered = filtered.filter((task) => task.isFavorited === true)
		}

		// Filter by date range
		if (options.dateRange) {
			const { start, end } = options.dateRange
			if (start && end && start <= end) {
				const startTime = start.getTime()
				const endTime = end.getTime()
				filtered = filtered.filter((task) => {
					const taskTime = task.ts
					return taskTime >= startTime && taskTime <= endTime
				})
			}
		}

		return filtered
	}
}
