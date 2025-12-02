/**
 * Model list state management atoms
 * Handles pagination, sorting, and filtering for the /model list command
 */
import { atom } from "jotai"

export const MODEL_LIST_PAGE_SIZE = 10

export interface ModelListFilters {
	search?: string | undefined
	sort: "name" | "context" | "price" | "preferred"
	capabilities: ("images" | "cache" | "reasoning" | "free")[]
}

export interface ModelListState {
	pageIndex: number
	filters: ModelListFilters
}

// Default filters
export const defaultModelListFilters: ModelListFilters = {
	sort: "preferred",
	capabilities: [],
}

/**
 * Current page index (0-based)
 */
export const modelListPageIndexAtom = atom<number>(0)

/**
 * Current filters for model list
 */
export const modelListFiltersAtom = atom<ModelListFilters>(defaultModelListFilters)

/**
 * Action atom to update filters
 */
export const updateModelListFiltersAtom = atom(null, (get, set, filters: Partial<ModelListFilters>) => {
	const current = get(modelListFiltersAtom)
	const updated = { ...current, ...filters }
	// Remove search if it's explicitly set to undefined
	if ("search" in filters && filters.search === undefined) {
		delete updated.search
	}
	set(modelListFiltersAtom, updated)
	// Reset to first page when filters change
	set(modelListPageIndexAtom, 0)
})

/**
 * Action atom to change page
 */
export const changeModelListPageAtom = atom(null, (get, set, pageIndex: number) => {
	set(modelListPageIndexAtom, pageIndex)
})

/**
 * Action atom to reset model list state
 */
export const resetModelListStateAtom = atom(null, (get, set) => {
	set(modelListFiltersAtom, defaultModelListFilters)
	set(modelListPageIndexAtom, 0)
})
