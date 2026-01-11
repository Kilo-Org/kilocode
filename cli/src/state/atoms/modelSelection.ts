import { atom } from "jotai"
import type { ProviderName } from "../../types/messages.js"
import type { ModelInfo } from "../../constants/providers/models.js"
import { filterAndSortModels, getModelIdKey } from "../../constants/providers/models.js"
import { providerAtom, updateProviderAtom } from "./config.js"
import { addMessageAtom, refreshTerminalAtom } from "./ui.js"

export const MODEL_CATALOG_PAGE_SIZE = 10

export type ModelCatalogSortOption = "name" | "context" | "price" | "preferred"
export type ModelCatalogCapabilityFilter = "images" | "cache" | "reasoning" | "free"

export const MODEL_CATALOG_SORT_OPTIONS: ModelCatalogSortOption[] = ["preferred", "name", "context", "price"]
export const MODEL_CATALOG_CAPABILITY_OPTIONS: ModelCatalogCapabilityFilter[] = ["images", "cache", "reasoning", "free"]

export interface ModelCatalogItem {
	provider: string
	modelId: string
	model: ModelInfo
	isCurrent: boolean
}

export const modelCatalogVisibleAtom = atom<boolean>(false)

export const modelCatalogSearchAtom = atom<string>("")

export const modelCatalogProviderFilterAtom = atom<ProviderName | null>(null)

export const modelCatalogSortAtom = atom<ModelCatalogSortOption>("preferred")

export const modelCatalogCapabilitiesAtom = atom<ModelCatalogCapabilityFilter[]>([])

export const modelCatalogPageAtom = atom<number>(0)

export const modelCatalogAllModelsAtom = atom<Partial<Record<ProviderName, Record<string, ModelInfo>>> | null>(null)

export const modelCatalogCurrentProviderAtom = atom<ProviderName | null>(null)

export const modelCatalogCurrentModelIdAtom = atom<string>("")

export const modelCatalogItemsAtom = atom<ModelCatalogItem[]>((get) => {
	const allModels = get(modelCatalogAllModelsAtom)
	const currentProvider = get(modelCatalogCurrentProviderAtom)
	const currentModelId = get(modelCatalogCurrentModelIdAtom)
	const search = get(modelCatalogSearchAtom)
	const sort = get(modelCatalogSortAtom)
	const capabilities = get(modelCatalogCapabilitiesAtom)
	const providerFilter = get(modelCatalogProviderFilterAtom)

	if (!allModels || !currentProvider || !currentModelId) {
		return []
	}

	return filterAndSortModels({
		allModels,
		currentProvider,
		currentModelId,
		filters: {
			search,
			sort,
			capabilities,
			provider: providerFilter,
		},
	})
})

export const modelCatalogPageCountAtom = atom<number>((get) => {
	const items = get(modelCatalogItemsAtom)
	return Math.ceil(items.length / MODEL_CATALOG_PAGE_SIZE)
})

export const modelCatalogVisibleItemsAtom = atom<ModelCatalogItem[]>((get) => {
	const items = get(modelCatalogItemsAtom)
	const page = get(modelCatalogPageAtom)
	const start = page * MODEL_CATALOG_PAGE_SIZE
	return items.slice(start, start + MODEL_CATALOG_PAGE_SIZE)
})

export const modelCatalogSelectedIndexAtom = atom<number>(0)

export const modelCatalogSelectedItemAtom = atom<ModelCatalogItem | null>((get) => {
	const visibleItems = get(modelCatalogVisibleItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	return visibleItems[selectedIndex] ?? null
})

export const modelCatalogDeprecationWarningsShownAtom = atom<Set<string>>(() => new Set())

export const openModelCatalogAtom = atom(
	null,
	(
		get,
		set,
		params: {
			allModels: Partial<Record<ProviderName, Record<string, ModelInfo>>>
			currentProvider: ProviderName
			currentModelId: string
		},
	) => {
		set(modelCatalogAllModelsAtom, params.allModels)
		set(modelCatalogCurrentProviderAtom, params.currentProvider)
		set(modelCatalogCurrentModelIdAtom, params.currentModelId)
		set(modelCatalogSearchAtom, "")
		set(modelCatalogPageAtom, 0)
		set(modelCatalogSelectedIndexAtom, 0)
		set(modelCatalogVisibleAtom, true)
	},
)

export const closeModelCatalogAtom = atom(null, (get, set) => {
	set(modelCatalogVisibleAtom, false)
	// Reset search and selection state to ensure clean state for next open
	set(modelCatalogSearchAtom, "")
	set(modelCatalogSelectedIndexAtom, 0)
	set(modelCatalogPageAtom, 0)
})

export const setModelCatalogSearchAtom = atom(null, (get, set, search: string) => {
	set(modelCatalogSearchAtom, search)
	set(modelCatalogPageAtom, 0)
	set(modelCatalogSelectedIndexAtom, 0)
})

export const cycleModelCatalogSortAtom = atom(null, (get, set) => {
	const currentSort = get(modelCatalogSortAtom)
	const sorts: ModelCatalogSortOption[] = ["preferred", "name", "context", "price"]
	const currentIndex = sorts.indexOf(currentSort)
	let nextSort: ModelCatalogSortOption = "preferred"
	if (currentIndex !== -1) {
		nextSort = sorts[(currentIndex + 1) % sorts.length] ?? "preferred"
	}
	set(modelCatalogSortAtom, nextSort)
	set(modelCatalogPageAtom, 0)
	set(modelCatalogSelectedIndexAtom, 0)
})

export const cycleModelCatalogCapabilityFilterAtom = atom(null, (get, set) => {
	const currentCapabilities = get(modelCatalogCapabilitiesAtom)
	const options: ModelCatalogCapabilityFilter[] = ["images", "cache", "reasoning", "free"]
	const firstOption = options[0]

	if (firstOption === undefined) {
		return
	}

	if (currentCapabilities.length === 0) {
		set(modelCatalogCapabilitiesAtom, [firstOption])
	} else {
		const currentCap = currentCapabilities[0]
		if (currentCap !== undefined) {
			const currentIndex = options.indexOf(currentCap)
			if (currentIndex !== -1) {
				const nextIndex = (currentIndex + 1) % options.length
				if (nextIndex === 0) {
					set(modelCatalogCapabilitiesAtom, [])
				} else {
					const nextCap = options[nextIndex]
					if (nextCap !== undefined) {
						set(modelCatalogCapabilitiesAtom, [nextCap])
					}
				}
			}
		}
	}
	set(modelCatalogPageAtom, 0)
	set(modelCatalogSelectedIndexAtom, 0)
})

export const cycleModelCatalogProviderFilterAtom = atom(null, (get, set) => {
	const currentFilter = get(modelCatalogProviderFilterAtom)
	const allModels = get(modelCatalogAllModelsAtom)

	if (!allModels) return

	const providers = Object.keys(allModels) as ProviderName[]
	if (currentFilter === null) {
		const firstProvider = providers[0]
		if (firstProvider !== undefined) {
			set(modelCatalogProviderFilterAtom, firstProvider)
		}
	} else {
		const currentIndex = providers.indexOf(currentFilter)
		const nextIndex = (currentIndex + 1) % providers.length
		const nextProvider = providers[nextIndex]
		if (nextProvider !== undefined) {
			set(modelCatalogProviderFilterAtom, nextProvider)
		}
	}
	set(modelCatalogPageAtom, 0)
	set(modelCatalogSelectedIndexAtom, 0)
})

export const nextModelCatalogPageAtom = atom(null, (get, set) => {
	const page = get(modelCatalogPageAtom)
	const pageCount = get(modelCatalogPageCountAtom)
	if (page < pageCount - 1) {
		set(modelCatalogPageAtom, page + 1)
		set(modelCatalogSelectedIndexAtom, 0)
	}
})

export const prevModelCatalogPageAtom = atom(null, (get, set) => {
	const page = get(modelCatalogPageAtom)
	if (page > 0) {
		set(modelCatalogPageAtom, page - 1)
		set(modelCatalogSelectedIndexAtom, 0)
	}
})

export const selectNextModelCatalogItemAtom = atom(null, (get, set) => {
	const visibleItems = get(modelCatalogVisibleItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const nextIndex = (selectedIndex + 1) % visibleItems.length
	set(modelCatalogSelectedIndexAtom, nextIndex)
})

export const selectPreviousModelCatalogItemAtom = atom(null, (get, set) => {
	const visibleItems = get(modelCatalogVisibleItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const prevIndex = selectedIndex === 0 ? visibleItems.length - 1 : selectedIndex - 1
	set(modelCatalogSelectedIndexAtom, prevIndex)
})

export const selectModelCatalogItemAtom = atom(null, async (get, set) => {
	const selectedItem = get(modelCatalogSelectedItemAtom)
	const currentProvider = get(providerAtom)

	if (!selectedItem || !currentProvider) {
		return
	}

	set(modelCatalogVisibleAtom, false)

	try {
		const modelIdKey = getModelIdKey(selectedItem.provider as ProviderName)
		await set(updateProviderAtom, currentProvider.id, {
			[modelIdKey]: selectedItem.modelId,
		})

		let content = `Switched to **${selectedItem.modelId}**\n`
		if (selectedItem.model.displayName) {
			content += `Display Name: ${selectedItem.model.displayName}\n`
		}
		content += `Provider: ${selectedItem.provider}\n`
		if (selectedItem.model.contextWindow) {
			const contextK = Math.floor(selectedItem.model.contextWindow / 1000)
			content += `Context Window: ${contextK}K tokens\n`
		}

		set(addMessageAtom, {
			id: Date.now().toString(),
			type: "system",
			content,
			ts: Date.now(),
		})
	} catch (error) {
		set(addMessageAtom, {
			id: Date.now().toString(),
			type: "error",
			content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
})
