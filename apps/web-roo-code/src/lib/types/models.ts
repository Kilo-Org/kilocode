export interface ModelPricing {
	input: string
	output: string
	input_cache_read: string
	input_cache_write: string
}

export interface Model {
	id: string
	object: string
	created: number
	owned_by: string
	name: string
	description: string
	context_window: number
	max_tokens: number
	type: string
	tags: string[]
	pricing: ModelPricing
	deprecated?: boolean
}

export interface ModelsResponse {
	data: Model[]
}

export interface ModelWithTotalPrice extends Model {
	totalPrice: number
}

export type SortOption = "alphabetical" | "price-asc" | "price-desc" | "context-window-asc" | "context-window-desc"
