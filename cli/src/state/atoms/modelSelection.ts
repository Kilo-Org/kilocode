import { atom } from "jotai"
import type { ProviderName } from "../../types/messages.js"
import type { ModelInfo } from "../../constants/providers/models.js"
import { filterAndSortModels, getModelIdKey } from "../../constants/providers/models.js"
import { providerAtom, updateProviderAtom } from "./config.js"
import { addMessageAtom } from "./ui.js"
import { MODEL_SORT_OPTIONS, MODEL_CAPABILITY_OPTIONS } from "../../types/modelCatalog.js"
import type { ModelSortOption, ModelCapabilityFilter } from "../../types/modelCatalog.js"

export const MODEL_CATALOG_VISIBLE_WINDOW = 10

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
	return Math.ceil(items.length / MODEL_CATALOG_VISIBLE_WINDOW)
})

export const modelCatalogTotalItemsAtom = atom<number>((get) => {
	return get(modelCatalogItemsAtom).length
})

export const modelCatalogVisibleItemsAtom = atom<ModelCatalogItem[]>((get) => {
	const items = get(modelCatalogItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const totalItems = items.length
	const windowSize = MODEL_CATALOG_VISIBLE_WINDOW

	if (totalItems <= windowSize) {
		return items
	}

	let windowStart = selectedIndex - windowSize + 1
	windowStart = Math.max(0, windowStart)
	windowStart = Math.min(windowStart, totalItems - windowSize)

	return items.slice(windowStart, windowStart + windowSize)
})

export const modelCatalogVisibleWindowStartAtom = atom<number>((get) => {
	const items = get(modelCatalogItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const totalItems = items.length
	const windowSize = MODEL_CATALOG_VISIBLE_WINDOW

	if (totalItems <= windowSize) {
		return 0
	}

	let windowStart = selectedIndex - windowSize + 1
	windowStart = Math.max(0, windowStart)
	windowStart = Math.min(windowStart, totalItems - windowSize)

	return windowStart
})

export const modelCatalogSelectedIndexAtom = atom<number>(0)

export const modelCatalogSelectedItemAtom = atom<ModelCatalogItem | null>((get) => {
	const items = get(modelCatalogItemsAtom)
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	return items[selectedIndex] ?? null
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
		set(modelCatalogVisibleAtom, true)

		const items = get(modelCatalogItemsAtom)
		const currentIndex = items.findIndex(
			(item) => item.provider === params.currentProvider && item.modelId === params.currentModelId,
		)
		set(modelCatalogSelectedIndexAtom, currentIndex >= 0 ? currentIndex : 0)
	},
)

export const closeModelCatalogAtom = atom(null, (get, set) => {
	set(modelCatalogVisibleAtom, false)
	set(modelCatalogSearchAtom, "")
	set(modelCatalogSelectedIndexAtom, 0)
})

export const setModelCatalogSearchAtom = atom(null, (get, set, search: string) => {
	set(modelCatalogSearchAtom, search)
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
	set(modelCatalogSelectedIndexAtom, 0)
})

export const nextModelCatalogPageAtom = atom(null, (_get, _set) => {
	// No longer used - navigation is continuous with up/down arrows
})

export const prevModelCatalogPageAtom = atom(null, (_get, _set) => {
	// No longer used - navigation is continuous with up/down arrows
})

export const selectNextModelCatalogItemAtom = atom(null, (get, set) => {
	const items = get(modelCatalogItemsAtom)
	if (items.length === 0) return
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const newIndex = (selectedIndex + 1) % items.length
	set(modelCatalogSelectedIndexAtom, newIndex)
})

export const selectPreviousModelCatalogItemAtom = atom(null, (get, set) => {
	const items = get(modelCatalogItemsAtom)
	if (items.length === 0) return
	const selectedIndex = get(modelCatalogSelectedIndexAtom)
	const newIndex = (selectedIndex - 1 + items.length) % items.length
	set(modelCatalogSelectedIndexAtom, newIndex)
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
