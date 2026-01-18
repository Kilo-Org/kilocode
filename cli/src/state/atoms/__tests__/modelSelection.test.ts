import { createStore, atom } from "jotai"
import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock the dependencies FIRST before importing atoms
vi.mock("../config.js", () => {
	const configAtom = atom({
		provider: "kilocode",
		providers: [{ id: "kilocode", kilocodeModel: "old-model" }] as Array<{ id: string; [key: string]: unknown }>,
	})
	return {
		configAtom,
		providerAtom: atom((get) => {
			const config = get(configAtom)
			return config.providers.find((p) => p.id === config.provider)
		}),
		updateProviderAtom: atom(null, (get, set, id, updates) => {
			const config = get(configAtom)
			const providers = config.providers.map((p) =>
				p.id === id ? { ...p, ...(updates as Record<string, unknown>) } : p,
			)
			set(configAtom, { ...config, providers })
		}),
	}
})

vi.mock("../../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock("../../../services/telemetry/index.js", () => ({
	getTelemetryService: () => ({
		trackConfigLoaded: vi.fn(),
		trackConfigSaved: vi.fn(),
		trackProviderChanged: vi.fn(),
	}),
}))

import {
	modelCatalogVisibleAtom,
	modelCatalogSearchAtom,
	modelCatalogProviderFilterAtom,
	modelCatalogSortAtom,
	modelCatalogCapabilitiesAtom,
	modelCatalogPageAtom,
	modelCatalogAllModelsAtom,
	modelCatalogCurrentProviderAtom,
	modelCatalogCurrentModelIdAtom,
	modelCatalogItemsAtom,
	modelCatalogPageCountAtom,
	modelCatalogVisibleItemsAtom,
	modelCatalogSelectedIndexAtom,
	modelCatalogTotalItemsAtom,
	modelCatalogVisibleWindowStartAtom,
	openModelCatalogAtom,
	closeModelCatalogAtom,
	setModelCatalogSearchAtom,
	cycleModelCatalogSortAtom,
	cycleModelCatalogCapabilityFilterAtom,
	cycleModelCatalogProviderFilterAtom,
	selectNextModelCatalogItemAtom,
	selectPreviousModelCatalogItemAtom,
	selectModelCatalogItemAtom,
	MODEL_CATALOG_VISIBLE_WINDOW,
} from "../modelSelection.js"
import { configAtom } from "../config.js"
import type { ModelInfo } from "../../../constants/providers/models.js"
import type { ProviderName } from "../../../types/messages.js"
import type { CLIConfig } from "../../../config/types.js"

// Mock models for testing
const mockModels: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	kilocode: {
		"model-a": { contextWindow: 8000, supportsPromptCache: true, displayName: "Model A" },
		"model-b": { contextWindow: 16000, supportsImages: true, supportsPromptCache: false, displayName: "Model B" },
	},
	anthropic: {
		"claude-3-5-sonnet": {
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: true,
			displayName: "Claude 3.5 Sonnet",
		},
		"claude-3-opus": {
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: false,
			displayName: "Claude 3 Opus",
		},
	},
	openai: {
		"gpt-4o": { contextWindow: 128000, supportsImages: true, supportsPromptCache: false, displayName: "GPT-4o" },
		"gpt-3.5-turbo": {
			contextWindow: 16000,
			supportsImages: false,
			supportsPromptCache: false,
			displayName: "GPT 3.5 Turbo",
		},
	},
}

// Generate enough models to test pagination
const manyModels: Record<string, ModelInfo> = {}
for (let i = 1; i <= 25; i++) {
	manyModels[`model-${i}`] = { contextWindow: 1000, supportsPromptCache: false, displayName: `Model ${i}` }
}
const mockModelsMany: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	kilocode: manyModels,
}

describe("modelSelection atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		// Initialize configAtom with default test state
		store.set(configAtom, {
			provider: "kilocode",
			providers: [{ id: "kilocode", kilocodeModel: "old-model" }],
		} as unknown as CLIConfig)
	})

	describe("Initialization and Reset", () => {
		it("should initialize with default values", () => {
			expect(store.get(modelCatalogVisibleAtom)).toBe(false)
			expect(store.get(modelCatalogSearchAtom)).toBe("")
			expect(store.get(modelCatalogProviderFilterAtom)).toBe("kilocode")
			expect(store.get(modelCatalogSortAtom)).toBe("preferred")
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual([])
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)
		})

		it("openModelCatalogAtom should set up state", () => {
			store.set(openModelCatalogAtom, {
				allModels: mockModels,
				currentProvider: "kilocode",
				currentModelId: "model-a",
			})

			expect(store.get(modelCatalogVisibleAtom)).toBe(true)
			expect(store.get(modelCatalogAllModelsAtom)).toEqual(mockModels)
			expect(store.get(modelCatalogCurrentProviderAtom)).toBe("kilocode")
			expect(store.get(modelCatalogCurrentModelIdAtom)).toBe("model-a")
			expect(store.get(modelCatalogSearchAtom)).toBe("")
			// Current model should be selected
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)
		})

		it("closeModelCatalogAtom should reset state", () => {
			store.set(modelCatalogVisibleAtom, true)
			store.set(modelCatalogSearchAtom, "searching")
			store.set(modelCatalogSelectedIndexAtom, 5)

			store.set(closeModelCatalogAtom)

			expect(store.get(modelCatalogVisibleAtom)).toBe(false)
			expect(store.get(modelCatalogSearchAtom)).toBe("")
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)
		})
	})

	describe("Derived atoms (Items, Pagination, Selection)", () => {
		beforeEach(() => {
			store.set(openModelCatalogAtom, {
				allModels: mockModels,
				currentProvider: "kilocode",
				currentModelId: "model-a",
			})
		})

		it("modelCatalogItemsAtom should return filtered items", () => {
			// Default provider filter is "kilocode"
			const items = store.get(modelCatalogItemsAtom)
			expect(items).toHaveLength(2)
			expect(items[0].provider).toBe("kilocode")
		})

		it("should filter by search term", () => {
			store.set(setModelCatalogSearchAtom, "sonnet")
			store.set(modelCatalogProviderFilterAtom, "all")
			const items = store.get(modelCatalogItemsAtom)
			expect(items).toHaveLength(1)
			expect(items[0].modelId).toBe("claude-3-5-sonnet")
		})

		it("should filter by capabilities", () => {
			store.set(modelCatalogProviderFilterAtom, "all")
			store.set(modelCatalogCapabilitiesAtom, ["cache"])
			const items = store.get(modelCatalogItemsAtom)
			// model-a, claude-3-5-sonnet
			expect(items).toHaveLength(2)
			expect(items.map((i) => i.modelId)).toContain("model-a")
			expect(items.map((i) => i.modelId)).toContain("claude-3-5-sonnet")
		})

		it("should handle continuous scrolling with fixed window", () => {
			store.set(openModelCatalogAtom, {
				allModels: mockModelsMany,
				currentProvider: "kilocode",
				currentModelId: "model-1",
			})

			expect(store.get(modelCatalogTotalItemsAtom)).toBe(25)
			expect(store.get(modelCatalogVisibleItemsAtom)).toHaveLength(MODEL_CATALOG_VISIBLE_WINDOW)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)
			expect(store.get(modelCatalogVisibleWindowStartAtom)).toBe(0)

			// Navigate to item 9 (last item in first window)
			for (let i = 0; i < 9; i++) {
				store.set(selectNextModelCatalogItemAtom)
			}
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(9)
			expect(store.get(modelCatalogVisibleWindowStartAtom)).toBe(0)

			// Navigate to item 10 - should scroll window
			store.set(selectNextModelCatalogItemAtom)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(10)
			expect(store.get(modelCatalogVisibleWindowStartAtom)).toBe(1)

			// Navigate to end
			for (let i = 11; i < 25; i++) {
				store.set(selectNextModelCatalogItemAtom)
			}
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(24)

			// Navigate past end - should wrap to beginning
			store.set(selectNextModelCatalogItemAtom)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)

			// Navigate past beginning - should wrap to end
			store.set(selectPreviousModelCatalogItemAtom)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(24)
		})

		it("should handle item selection navigation with wrap", () => {
			store.set(openModelCatalogAtom, {
				allModels: mockModelsMany,
				currentProvider: "kilocode",
				currentModelId: "model-1",
			})

			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)

			store.set(selectNextModelCatalogItemAtom)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(1)

			// Go to end of list
			for (let i = 2; i < 25; i++) {
				store.set(selectNextModelCatalogItemAtom)
			}
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(24)

			// Should wrap back to beginning
			store.set(selectNextModelCatalogItemAtom)
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(0)

			store.set(selectPreviousModelCatalogItemAtom)
			// Should wrap back to end
			expect(store.get(modelCatalogSelectedIndexAtom)).toBe(24)
		})
	})

	describe("Action atoms (Cycling filters)", () => {
		it("cycleModelCatalogSortAtom should cycle through sorts", () => {
			expect(store.get(modelCatalogSortAtom)).toBe("preferred")
			store.set(cycleModelCatalogSortAtom)
			expect(store.get(modelCatalogSortAtom)).toBe("name")
			store.set(cycleModelCatalogSortAtom)
			expect(store.get(modelCatalogSortAtom)).toBe("context")
			store.set(cycleModelCatalogSortAtom)
			expect(store.get(modelCatalogSortAtom)).toBe("price")
			store.set(cycleModelCatalogSortAtom)
			expect(store.get(modelCatalogSortAtom)).toBe("preferred")
		})

		it("cycleModelCatalogProviderFilterAtom should cycle through providers", () => {
			store.set(modelCatalogAllModelsAtom, mockModels)
			store.set(modelCatalogProviderFilterAtom, "kilocode")

			store.set(cycleModelCatalogProviderFilterAtom)
			expect(store.get(modelCatalogProviderFilterAtom)).toBe("anthropic")

			store.set(cycleModelCatalogProviderFilterAtom)
			expect(store.get(modelCatalogProviderFilterAtom)).toBe("openai")

			store.set(cycleModelCatalogProviderFilterAtom)
			expect(store.get(modelCatalogProviderFilterAtom)).toBe("all")

			store.set(cycleModelCatalogProviderFilterAtom)
			expect(store.get(modelCatalogProviderFilterAtom)).toBe("kilocode")
		})

		it("cycleModelCatalogCapabilityFilterAtom should cycle through capabilities", () => {
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual([])

			store.set(cycleModelCatalogCapabilityFilterAtom)
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual(["images"])

			store.set(cycleModelCatalogCapabilityFilterAtom)
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual(["cache"])

			store.set(cycleModelCatalogCapabilityFilterAtom)
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual(["reasoning"])

			store.set(cycleModelCatalogCapabilityFilterAtom)
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual(["free"])

			store.set(cycleModelCatalogCapabilityFilterAtom)
			expect(store.get(modelCatalogCapabilitiesAtom)).toEqual([])
		})
	})

	describe("selectModelCatalogItemAtom", () => {
		it("should update config when model is selected", async () => {
			store.set(openModelCatalogAtom, {
				allModels: mockModels,
				currentProvider: "kilocode",
				currentModelId: "model-a",
			})

			// Select first item (model-a)
			await store.set(selectModelCatalogItemAtom)

			const config = store.get(configAtom) as { providers: Array<{ kilocodeModel: string }> }
			expect(config.providers[0].kilocodeModel).toBe("model-a")
			expect(store.get(modelCatalogVisibleAtom)).toBe(false)
		})
	})
})
