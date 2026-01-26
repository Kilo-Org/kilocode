import { Box, Text } from "ink"
import Fuzzysort from "fuzzysort"

import { Icon } from "../../Icon.js"
import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface FileResult extends AutocompleteItem {
	path: string
	type: "file" | "folder"
	label?: string
}

/**
 * Props for creating a file trigger
 */
export interface FileTriggerConfig {
	/**
	 * Called when a search should be performed.
	 * This typically triggers an API call to search files.
	 */
	onSearch: (query: string) => void
	/**
	 * Current search results from the store/API.
	 * Results are provided externally because file search is async.
	 */
	getResults: () => FileResult[]
}

/**
 * Create a file trigger for @ mentions.
 *
 * This trigger activates when the user types @ followed by text,
 * and allows selecting files to insert as @/path references.
 *
 * The file trigger uses async data fetching:
 * - search() triggers the API call and returns [] immediately
 * - When API responds, App.tsx calls forceRefresh()
 * - refreshResults() then returns the actual results from the store
 *
 * @param config - Configuration for the trigger
 * @returns AutocompleteTrigger for file mentions
 */
export function createFileTrigger(config: FileTriggerConfig): AutocompleteTrigger<FileResult> {
	const { onSearch, getResults } = config

	// Helper function to get results and apply fuzzy sorting
	function getResultsWithFuzzySort(query: string): FileResult[] {
		const results = getResults()

		// Sort results by fuzzy match score (best matches first)
		if (!query || results.length === 0) {
			return results
		}

		const fuzzyResults = Fuzzysort.go(query, results, {
			key: "path",
			threshold: -10000, // Include all results
		})

		return fuzzyResults.map((result) => result.obj)
	}

	return {
		id: "file",
		triggerChar: "@",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Find the last @ in the line
			const atIndex = lineText.lastIndexOf("@")

			if (atIndex === -1) {
				return null
			}

			// Extract query after @
			const query = lineText.substring(atIndex + 1)

			// Close picker if query contains space (user finished typing)
			if (query.includes(" ")) {
				return null
			}

			// Unlike other triggers that only work at line-start, @ can appear anywhere
			// and should show results even with an empty query (just "@" typed)
			return { query, triggerIndex: atIndex }
		},

		search: (query: string): FileResult[] => {
			// Trigger the external async search
			onSearch(query)

			// Return empty immediately - don't bother calling getResults() since
			// we know the async API hasn't responded yet.
			// When results arrive, App.tsx will call forceRefresh() which uses
			// refreshResults() to get the actual data from the store.
			return []
		},

		// refreshResults: Get current results without triggering a new API call
		// This is used by forceRefresh when async results arrive
		refreshResults: (query: string): FileResult[] => {
			return getResultsWithFuzzySort(query)
		},

		renderItem: (item: FileResult, isSelected: boolean) => {
			const iconName = item.type === "folder" ? "folder" : "file"
			const color = isSelected ? "cyan" : item.type === "folder" ? "blue" : undefined

			return (
				<Box paddingLeft={2}>
					<Icon name={iconName} color={color} />
					<Text> </Text>
					<Text color={color}>{item.path}</Text>
				</Box>
			)
		},

		getReplacementText: (item: FileResult, lineText: string, triggerIndex: number): string => {
			const beforeAt = lineText.substring(0, triggerIndex)
			return `${beforeAt}@/${item.path} `
		},

		emptyMessage: "No matching files found",
		debounceMs: 150,
	}
}

/**
 * Convert external FileSearchResult to FileResult.
 * Use this to adapt results from the store to the trigger's expected type.
 */
export function toFileResult(result: { path: string; type: "file" | "folder"; label?: string }): FileResult {
	return {
		key: result.path,
		path: result.path,
		type: result.type,
		label: result.label,
	}
}
