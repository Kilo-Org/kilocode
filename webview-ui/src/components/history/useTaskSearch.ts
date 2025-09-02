import { useState, useEffect } from "react"
import { useTaskHistory } from "@src/hooks/useTaskHistory"
import { useExtensionState } from "@src/context/ExtensionStateContext"

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

export const useTaskSearch = () => {
	const { cwd } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)
	const [favoritesOnly, setFavoritesOnly] = useState(false)

	const { tasks, loading, error, sendRequest } = useTaskHistory()

	console.log("[useTaskSearch] Hook state:", {
		tasksCount: tasks.length,
		loading,
		error,
		cwd,
		showAllWorkspaces,
		favoritesOnly,
		searchQuery,
		sortOption,
	})

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	// Send backend requests when filters change
	useEffect(() => {
		const filters = {
			workspace: showAllWorkspaces ? undefined : cwd,
			favoritesOnly,
			sortBy:
				sortOption === "newest"
					? ("date" as const)
					: sortOption === "oldest"
						? ("date" as const)
						: sortOption === "mostExpensive"
							? undefined
							: sortOption === "mostTokens"
								? undefined
								: undefined,
			page: 1,
			limit: 20,
		}

		if (searchQuery.trim()) {
			// Use search mode for queries
			sendRequest("search", filters, searchQuery)
		} else if (favoritesOnly) {
			// Use favorites mode when showing favorites only
			sendRequest("favorites", filters)
		} else {
			// Use page mode for regular browsing
			sendRequest("page", filters)
		}
	}, [searchQuery, showAllWorkspaces, favoritesOnly, sortOption, cwd, sendRequest])

	return {
		tasks,
		loading,
		error,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		lastNonRelevantSort,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
		favoritesOnly,
		setFavoritesOnly,
	}
}
