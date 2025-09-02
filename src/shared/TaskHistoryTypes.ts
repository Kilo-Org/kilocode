import { HistoryItem } from "@roo-code/types"

/**
 * Core filter type that matches TaskHistoryService.SearchOptions
 * Preserves existing backend naming conventions
 */
export interface TaskHistoryFilters {
	workspace?: string
	favoritesOnly?: boolean // Renamed for better consistency
	sortBy?: "date" | "name" | "workspace"
	page?: number
	limit?: number
	dateRange?: { start: Date; end: Date } // Include dateRange from backend
}

/**
 * Mode type for different request types
 */
export type TaskHistoryMode = "search" | "favorites" | "page" | "promptHistory" | "metadata"

/**
 * Response data structure with single totalCount and flat structure
 * Aligns with existing TaskHistoryService return types
 */
export interface TaskHistoryResponseData {
	type: TaskHistoryMode
	tasks?: HistoryItem[]
	totalCount: number // Single source of truth
	favoriteCount: number // Flat structure, not nested
	hasMore?: boolean // Keep this - backend provides it correctly
	pageNumber?: number
	totalPages?: number
	promptHistory?: string[]
	error?: string
}
