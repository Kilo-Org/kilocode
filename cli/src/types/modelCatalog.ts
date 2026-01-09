import type { ModelInfo } from "../constants/providers/models.js"

export interface ModelCatalogItem {
	provider: string
	modelId: string
	model: ModelInfo
	isCurrent: boolean
}

export type ModelSortOption = "name" | "context" | "price" | "preferred"

export type ModelCapabilityFilter = "images" | "cache" | "reasoning" | "free"

export type ModelSorts = ModelSortOption[]
export const MODEL_SORT_OPTIONS: ModelSorts = ["preferred", "name", "context", "price"]

export type ModelCapabilities = ModelCapabilityFilter[]
export const MODEL_CAPABILITY_OPTIONS: ModelCapabilities = ["images", "cache", "reasoning", "free"]

export interface ModelCatalogFilters {
	search: string
	sort: ModelSortOption
	capabilities: ModelCapabilities
	provider: string | null
}
