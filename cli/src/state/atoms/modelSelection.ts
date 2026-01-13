import { atom } from "jotai"
import type { ProviderName } from "../../types/messages.js"
import type { ModelInfo } from "../../constants/providers/models.js"
import { filterAndSortModels, getModelIdKey } from "../../constants/providers/models.js"
import { providerAtom, updateProviderAtom } from "./config.js"
import { addMessageAtom } from "./ui.js"
import { MODEL_SORT_OPTIONS, MODEL_CAPABILITY_OPTIONS } from "../../types/modelCatalog.js"
import type { ModelSortOption, ModelCapabilityFilter } from "../../types/modelCatalog.js"

export const MODEL_CATALOG_PAGE_SIZE = 10

export interface ModelCatalogItem {
	provider: string
	modelId: string
	model: ModelInfo
	isCurrent: boolean
}

export const modelCatalogVisibleAtom = atom<boolean>(false)

export const modelCatalogSearchAtom = atom<string>("")

export const modelCatalogProviderFilterAtom = atom<ProviderName | "all" | "kilocode">("kilocode")

export const modelCatalogSortAtom = atom<ModelSortOption>("preferred")

export const modelCatalogCapabilitiesAtom = atom<ModelCapabilityFilter[]>([])

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
			provider: providerFilter === "all" ? null : (providerFilter as ProviderName),
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
	const sorts: ModelSortOption[] = MODEL_SORT_OPTIONS
	const currentIndex = sorts.indexOf(currentSort)
	let nextSort: ModelSortOption = "preferred"
	if (currentIndex !== -1) {
		nextSort = sorts[(currentIndex + 1) % sorts.length] ?? "preferred"
	}
	set(modelCatalogSortAtom, nextSort)
	set(modelCatalogPageAtom, 0)
	set(modelCatalogSelectedIndexAtom, 0)
})

export const cycleModelCatalogCapabilityFilterAtom = atom(null, (get, set) => {
	const currentCapabilities = get(modelCatalogCapabilitiesAtom)
	const options: ModelCapabilityFilter[] = MODEL_CAPABILITY_OPTIONS
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

	// Start from kilocode, then cycle through all providers, and "all" is always the last option
	const sortedProviders: Array<ProviderName | "kilocode"> = [
		"kilocode",
		...providers.filter((p) => p !== "kilocode"),
	] as Array<ProviderName | "kilocode">

	const currentIndex =
		currentFilter === "all" ? sortedProviders.length : sortedProviders.indexOf(currentFilter as ProviderName)
	const nextIndex = (currentIndex + 1) % (sortedProviders.length + 1) // +1 for "all"

	if (nextIndex === sortedProviders.length) {
		set(modelCatalogProviderFilterAtom, "all")
	} else {
		const nextProvider = sortedProviders[nextIndex]
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
	if (visibleItems.length === 0) return
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const page = get(modelCatalogPageAtom)
	const pageCount = get(modelCatalogPageCountAtom)

	if (selectedIndex + 1 < visibleItems.length) {
		set(modelCatalogSelectedIndexAtom, selectedIndex + 1)
	} else if (page < pageCount - 1) {
		set(modelCatalogPageAtom, page + 1)
		set(modelCatalogSelectedIndexAtom, 0)
	}
})

export const selectPreviousModelCatalogItemAtom = atom(null, (get, set) => {
	const visibleItems = get(modelCatalogVisibleItemsAtom)
	if (visibleItems.length === 0) return
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const page = get(modelCatalogPageAtom)

	if (selectedIndex > 0) {
		set(modelCatalogSelectedIndexAtom, selectedIndex - 1)
	} else if (page > 0) {
		set(modelCatalogPageAtom, page - 1)
		const newPageItems = get(modelCatalogVisibleItemsAtom)
		set(modelCatalogSelectedIndexAtom, newPageItems.length - 1)
	}
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
