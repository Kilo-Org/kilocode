/**
 * /tasks command - View and manage task history
 */

import { generateMessage } from "../ui/utils/messages.js"
import type { Command, ArgumentProviderContext, CommandContext } from "./core/types.js"
import type { HistoryItem } from "@roo-code/types"
import type { TaskHistoryData, TaskHistoryFilters } from "../state/atoms/taskHistory.js"
import { formatRelativeTime } from "../utils/time.js"

const SORT_OPTION_MAP: Record<string, string> = {
	newest: "newest",
	oldest: "oldest",
	"most-expensive": "mostExpensive",
	"most-tokens": "mostTokens",
	"most-relevant": "mostRelevant",
}

/**
 * Format cost as a currency string
 */
function formatCost(cost: number): string {
	if (cost === 0) return "$0.00"
	if (cost < 0.01) return "<$0.01"
	return `$${cost.toFixed(2)}`
}

/**
 * Format tokens as a readable string
 */
function formatTokens(tokens: number): string {
	if (tokens >= 1000000) {
		return `${(tokens / 1000000).toFixed(1)}M`
	}
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}K`
	}
	return tokens.toString()
}

/**
 * Truncate text to a maximum length
 */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.substring(0, maxLength - 3) + "..."
}

/**
 * Show current task history
 */
async function showTaskHistory(context: CommandContext, dataOverride?: TaskHistoryData): Promise<void> {
	const { taskHistoryData, taskHistoryLoading, taskHistoryError, fetchTaskHistory, addMessage } = context

	// Use override data if provided, otherwise use context data
	const data = dataOverride || taskHistoryData

	// If loading, show loading message
	if (taskHistoryLoading && !dataOverride) {
		addMessage({
			...generateMessage(),
			type: "system",
			content: "Loading task history...",
		})
		return
	}

	// If error, show error message
	if (taskHistoryError && !dataOverride) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to load task history: ${taskHistoryError}`,
		})
		return
	}

	// If no data, fetch it
	if (!data) {
		await fetchTaskHistory()
		addMessage({
			...generateMessage(),
			type: "system",
			content: "Loading task history...",
		})
		return
	}

	const { historyItems, pageIndex, pageCount } = data

	if (historyItems.length === 0) {
		addMessage({
			...generateMessage(),
			type: "system",
			content: "No tasks found in history.",
		})
		return
	}

	// Build the task list display
	let content = `**Task History** (Page ${pageIndex + 1}/${pageCount}):\n\n`

	historyItems.forEach((task: HistoryItem, index: number) => {
		const taskNum = pageIndex * 10 + index + 1
		const taskText = truncate(task.task || "Untitled task", 60)
		const time = formatRelativeTime(task.ts || 0)
		const cost = formatCost(task.totalCost || 0)
		const totalTokens = (task.tokensIn || 0) + (task.tokensOut || 0)
		const tokens = formatTokens(totalTokens)
		const favorite = task.isFavorited ? "⭐ " : ""

		content += `${favorite}**${taskNum}.** ${taskText}\n`
		content += `   ID: ${task.id} | ${time} | ${cost} | ${tokens} tokens\n\n`
	})

	addMessage({
		...generateMessage(),
		type: "system",
		content,
	})
}

/**
 * Search tasks
 */
async function searchTasks(context: CommandContext, query: string): Promise<void> {
	const { updateTaskHistoryFilters, addMessage } = context

	if (!query) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /tasks search <query>",
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: `Searching for "${query}"...`,
	})

	try {
		// Wait for the new data to arrive
		const newData = await updateTaskHistoryFilters({ search: query, sort: "mostRelevant" })
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to search tasks: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Select a task by ID
 */
async function selectTask(context: CommandContext, taskId: string): Promise<void> {
	const { sendWebviewMessage, addMessage, replaceMessages, refreshTerminal } = context

	if (!taskId) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /tasks select <task-id>",
		})
		return
	}

	try {
		const now = Date.now()
		replaceMessages([
			{
				id: `empty-${now}`,
				type: "empty",
				content: "",
				ts: 1,
			},
			{
				id: `system-${now + 1}`,
				type: "system",
				content: `Switching to task ${taskId}...`,
				ts: 2,
			},
		])

		await refreshTerminal()

		sendWebviewMessage({
			type: "showTaskWithId",
			text: taskId,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to switch to task: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Change page
 */
async function changePage(context: CommandContext, pageNum: string): Promise<void> {
	const { taskHistoryData, changeTaskHistoryPage, addMessage } = context

	if (!taskHistoryData) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "No task history loaded. Use /tasks to load history first.",
		})
		return
	}

	const pageIndex = parseInt(pageNum, 10) - 1 // Convert to 0-based index

	if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= taskHistoryData.pageCount) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Invalid page number. Must be between 1 and ${taskHistoryData.pageCount}.`,
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: `Loading page ${pageIndex + 1}...`,
	})

	try {
		// Wait for the new data to arrive
		const newData = await changeTaskHistoryPage(pageIndex)
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to load page: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Go to next page
 */
async function nextPage(context: CommandContext): Promise<void> {
	const { taskHistoryData, nextTaskHistoryPage, addMessage } = context
	if (!taskHistoryData) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "No task history loaded. Use /tasks to load history first.",
		})
		return
	}

	if (taskHistoryData.pageIndex >= taskHistoryData.pageCount - 1) {
		addMessage({
			...generateMessage(),
			type: "system",
			content: "Already on the last page.",
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: "Loading next page...",
	})

	try {
		// Wait for the new data to arrive
		const newData = await nextTaskHistoryPage()
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to load next page: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Go to previous page
 */
async function previousPage(context: CommandContext): Promise<void> {
	const { taskHistoryData, previousTaskHistoryPage, addMessage } = context

	if (!taskHistoryData) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "No task history loaded. Use /tasks to load history first.",
		})
		return
	}

	if (taskHistoryData.pageIndex <= 0) {
		addMessage({
			...generateMessage(),
			type: "system",
			content: "Already on the first page.",
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: "Loading previous page...",
	})

	try {
		// Wait for the new data to arrive
		const newData = await previousTaskHistoryPage()
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to load previous page: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Change sort order
 */
async function changeSortOrder(context: CommandContext, sortOption: string): Promise<void> {
	const { updateTaskHistoryFilters, addMessage } = context

	const validSorts = Object.keys(SORT_OPTION_MAP)
	const mappedSort = SORT_OPTION_MAP[sortOption]

	if (!mappedSort) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Invalid sort option. Valid options: ${validSorts.join(", ")}`,
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: `Sorting by ${sortOption}...`,
	})

	try {
		// Wait for the new data to arrive
		const newData = await updateTaskHistoryFilters({ sort: mappedSort as TaskHistoryFilters["sort"] })
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to change sort order: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Change filter
 */
async function changeFilter(context: CommandContext, filterOption: string): Promise<void> {
	const { updateTaskHistoryFilters, addMessage } = context

	let filterUpdate: Partial<TaskHistoryFilters>
	let loadingMessage: string

	switch (filterOption) {
		case "current":
			filterUpdate = { workspace: "current" }
			loadingMessage = "Filtering to current workspace..."
			break

		case "all":
			filterUpdate = { workspace: "all" }
			loadingMessage = "Showing all workspaces..."
			break

		case "favorites":
			filterUpdate = { favoritesOnly: true }
			loadingMessage = "Showing favorites only..."
			break

		case "all-tasks":
			filterUpdate = { favoritesOnly: false }
			loadingMessage = "Showing all tasks..."
			break

		default:
			addMessage({
				...generateMessage(),
				type: "error",
				content: "Invalid filter option. Valid options: current, all, favorites, all-tasks",
			})
			return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: loadingMessage,
	})

	try {
		// Wait for the new data to arrive
		const newData = await updateTaskHistoryFilters(filterUpdate)
		// Now display the fresh data
		await showTaskHistory(context, newData)
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to change filter: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Autocomplete provider for task IDs
 */
async function taskIdAutocompleteProvider(context: ArgumentProviderContext) {
	if (!context.commandContext) {
		return []
	}

	const { taskHistoryData } = context.commandContext

	if (!taskHistoryData || !taskHistoryData.historyItems) {
		return []
	}

	return taskHistoryData.historyItems.map((task: HistoryItem) => ({
		value: task.id,
		title: truncate(task.task || "Untitled task", 50),
		description: `${formatRelativeTime(task.ts || 0)} | ${formatCost(task.totalCost || 0)}`,
		matchScore: 1.0,
		highlightedValue: task.id,
	}))
}

/**
 * Autocomplete provider for sort options
 */
async function sortOptionAutocompleteProvider(_context: ArgumentProviderContext) {
	return Object.keys(SORT_OPTION_MAP).map((option) => ({
		value: option,
		description: `Sort by ${option}`,
		matchScore: 1.0,
		highlightedValue: option,
	}))
}

/**
 * Autocomplete provider for filter options
 */
async function filterOptionAutocompleteProvider(_context: ArgumentProviderContext) {
	return [
		{ value: "current", description: "Current workspace only", matchScore: 1.0, highlightedValue: "current" },
		{ value: "all", description: "All workspaces", matchScore: 1.0, highlightedValue: "all" },
		{ value: "favorites", description: "Favorites only", matchScore: 1.0, highlightedValue: "favorites" },
		{ value: "all-tasks", description: "All tasks (no filter)", matchScore: 1.0, highlightedValue: "all-tasks" },
	]
}

export const tasksCommand: Command = {
	name: "tasks",
	aliases: ["t", "history"],
	description: "View and manage task history",
	usage: "/tasks [subcommand] [args]",
	examples: [
		"/tasks",
		"/tasks search bug fix",
		"/tasks select abc123",
		"/tasks page 2",
		"/tasks next",
		"/tasks prev",
		"/tasks sort most-expensive",
		"/tasks filter favorites",
	],
	category: "navigation",
	priority: 9,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: search, select, page, next, prev, sort, filter",
			required: false,
			values: [
				{ value: "search", description: "Search tasks by query" },
				{ value: "select", description: "Switch to a specific task" },
				{ value: "page", description: "Go to a specific page" },
				{ value: "next", description: "Go to next page" },
				{ value: "prev", description: "Go to previous page" },
				{ value: "sort", description: "Change sort order" },
				{ value: "filter", description: "Filter tasks" },
			],
		},
		{
			name: "argument",
			description: "Argument for the subcommand",
			required: false,
			provider: taskIdAutocompleteProvider,
			conditionalProviders: [
				{
					condition: (context) => context.getArgument("subcommand") === "select",
					provider: taskIdAutocompleteProvider,
				},
				{
					condition: (context) => context.getArgument("subcommand") === "sort",
					provider: sortOptionAutocompleteProvider,
				},
				{
					condition: (context) => context.getArgument("subcommand") === "filter",
					provider: filterOptionAutocompleteProvider,
				},
			],
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show current task history
		if (args.length === 0) {
			await showTaskHistory(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		if (!subcommand) {
			await showTaskHistory(context)
			return
		}

		// Handle subcommands
		switch (subcommand) {
			case "search":
				await searchTasks(context, args.slice(1).join(" "))
				break

			case "select":
				await selectTask(context, args[1] || "")
				break

			case "page":
				await changePage(context, args[1] || "")
				break

			case "next":
				await nextPage(context)
				break

			case "prev":
			case "previous":
				await previousPage(context)
				break

			case "sort":
				await changeSortOrder(context, args[1] || "")
				break

			case "filter":
				await changeFilter(context, args[1] || "")
				break

			default:
				context.addMessage({
					...generateMessage(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: search, select, page, next, prev, sort, filter`,
				})
		}
	},
}
