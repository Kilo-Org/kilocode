import { Box, Text } from "ink"
import fuzzysort from "fuzzysort"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

/**
 * History result type.
 * Extends AutocompleteItem with task history properties.
 */
export interface HistoryResult extends AutocompleteItem {
	/** Task ID */
	id: string
	/** Task prompt/description */
	task: string
	/** Timestamp when task was created */
	ts: number
	/** Total cost of the task */
	totalCost?: number
	/** Workspace path where task was run */
	workspace?: string
	/** Mode the task was run in */
	mode?: string
	/** Task status */
	status?: "active" | "completed" | "delegated"
}

/**
 * Props for creating a history trigger
 */
export interface HistoryTriggerConfig {
	/**
	 * Get all available history items for filtering.
	 * Items are filtered locally using fuzzy search.
	 */
	getHistory: () => HistoryResult[]
	/**
	 * Callback when a history item is selected.
	 * Used to resume the task.
	 */
	onSelect?: (item: HistoryResult) => void
	/**
	 * Maximum number of results to show.
	 * @default 15
	 */
	maxResults?: number
}

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(ts: number): string {
	const now = Date.now()
	const diff = now - ts

	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) {
		return days === 1 ? "1 day ago" : `${days} days ago`
	}
	if (hours > 0) {
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`
	}
	if (minutes > 0) {
		return minutes === 1 ? "1 min ago" : `${minutes} mins ago`
	}
	return "just now"
}

/**
 * Truncate text to a maximum length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text
	}
	return text.substring(0, maxLength - 1) + "…"
}

/**
 * Create a history trigger for # task history.
 *
 * This trigger activates when the user types # at the start of a line,
 * and allows selecting from task history with local fuzzy filtering.
 *
 * @param config - Configuration for the trigger
 * @returns AutocompleteTrigger for history
 */
export function createHistoryTrigger(config: HistoryTriggerConfig): AutocompleteTrigger<HistoryResult> {
	const { getHistory, maxResults = 15 } = config

	return {
		id: "history",
		triggerChar: "#",
		position: "line-start",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Check if line starts with # (after optional whitespace)
			const trimmed = lineText.trimStart()

			if (!trimmed.startsWith("#")) {
				return null
			}

			// Extract query after #
			const query = trimmed.substring(1)

			// Calculate trigger index (position of # in original line)
			const triggerIndex = lineText.length - trimmed.length

			return { query, triggerIndex }
		},

		search: (query: string): HistoryResult[] => {
			const allHistory = getHistory()

			if (query.length === 0) {
				// Show most recent items when just "#" is typed (sorted by timestamp, newest first)
				return allHistory.sort((a, b) => b.ts - a.ts).slice(0, maxResults)
			}

			// Fuzzy search by task description
			const results = fuzzysort.go(query, allHistory, {
				key: "task",
				limit: maxResults,
				threshold: -10000, // Be lenient with matching
			})

			return results.map((result) => result.obj)
		},

		renderItem: (item: HistoryResult, isSelected: boolean) => {
			// Status indicator
			const statusIcon = item.status === "completed" ? "✓" : item.status === "active" ? "●" : "○"
			const statusColor = item.status === "completed" ? "green" : item.status === "active" ? "yellow" : "gray"

			// Mode indicator (if available)
			const modeText = item.mode ? ` [${item.mode}]` : ""

			// Time ago
			const timeAgo = formatRelativeTime(item.ts)

			// Truncate task to fit in picker
			const truncatedTask = truncate(item.task.replace(/\n/g, " "), 50)

			return (
				<Box paddingLeft={2} flexDirection="row">
					<Text color={isSelected ? "cyan" : undefined}>
						<Text color={statusColor}>{statusIcon}</Text> {truncatedTask}
						<Text dimColor>{modeText}</Text>
						<Text dimColor> • {timeAgo}</Text>
					</Text>
				</Box>
			)
		},

		getReplacementText: (_item: HistoryResult, _lineText: string, _triggerIndex: number): string => {
			// Return empty string - we don't want to insert any text
			// The actual task resumption is handled via the onSelect callback
			return ""
		},

		emptyMessage: "No task history found",
		debounceMs: 100,
	}
}

/**
 * Convert HistoryItem from @roo-code/types to HistoryResult.
 * Use this to adapt history items from the store to the trigger's expected type.
 */
export function toHistoryResult(item: {
	id: string
	task: string
	ts: number
	totalCost?: number
	workspace?: string
	mode?: string
	status?: "active" | "completed" | "delegated"
}): HistoryResult {
	return {
		key: item.id, // Use task ID as the unique key
		id: item.id,
		task: item.task,
		ts: item.ts,
		totalCost: item.totalCost,
		workspace: item.workspace,
		mode: item.mode,
		status: item.status,
	}
}
