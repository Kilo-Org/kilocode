// kilocode_change - new file
// npx vitest run src/components/ui/hooks/kilocode/__tests__/usePreferredModels.spec.ts

import { renderHook } from "@testing-library/react"
import { useGroupedModelIds, getGroupedModelIds } from "../usePreferredModels"
import type { ModelInfo } from "@roo-code/types"

// Helper to create minimal ModelInfo objects for testing
const createModelInfo = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
	contextWindow: 100000,
	supportsPromptCache: false,
	maxTokens: 4096,
	...overrides,
})

describe("getGroupedModelIds", () => {
	it("returns empty arrays when models is null", () => {
		const result = getGroupedModelIds(null)

		expect(result).toEqual({
			preferredModelIds: [],
			restModelIds: [],
		})
	})

	it("returns empty arrays when models is empty", () => {
		const result = getGroupedModelIds({})

		expect(result).toEqual({
			preferredModelIds: [],
			restModelIds: [],
		})
	})

	it("separates preferred models from rest models", () => {
		const models: Record<string, ModelInfo> = {
			"model-a": createModelInfo({ preferredIndex: 1 }),
			"model-b": createModelInfo(),
			"model-c": createModelInfo({ preferredIndex: 0 }),
			"model-d": createModelInfo(),
		}

		const result = getGroupedModelIds(models)

		expect(result.preferredModelIds).toEqual(["model-c", "model-a"])
		expect(result.restModelIds).toEqual(["model-b", "model-d"])
	})

	it("sorts preferred models by preferredIndex", () => {
		const models: Record<string, ModelInfo> = {
			"model-z": createModelInfo({ preferredIndex: 2 }),
			"model-a": createModelInfo({ preferredIndex: 0 }),
			"model-m": createModelInfo({ preferredIndex: 1 }),
		}

		const result = getGroupedModelIds(models)

		expect(result.preferredModelIds).toEqual(["model-a", "model-m", "model-z"])
	})

	it("sorts rest models alphabetically", () => {
		const models: Record<string, ModelInfo> = {
			"zebra-model": createModelInfo(),
			"alpha-model": createModelInfo(),
			"beta-model": createModelInfo(),
		}

		const result = getGroupedModelIds(models)

		expect(result.restModelIds).toEqual(["alpha-model", "beta-model", "zebra-model"])
	})

	it("handles case where all models are preferred", () => {
		const models: Record<string, ModelInfo> = {
			"model-a": createModelInfo({ preferredIndex: 0 }),
			"model-b": createModelInfo({ preferredIndex: 1 }),
		}

		const result = getGroupedModelIds(models)

		expect(result.preferredModelIds).toEqual(["model-a", "model-b"])
		expect(result.restModelIds).toEqual([])
	})

	it("handles case where no models are preferred", () => {
		const models: Record<string, ModelInfo> = {
			"model-a": createModelInfo(),
			"model-b": createModelInfo(),
		}

		const result = getGroupedModelIds(models)

		expect(result.preferredModelIds).toEqual([])
		expect(result.restModelIds).toEqual(["model-a", "model-b"])
	})
})

describe("useGroupedModelIds", () => {
	it("returns grouped model IDs", () => {
		const models: Record<string, ModelInfo> = {
			"pref-model": createModelInfo({ preferredIndex: 0 }),
			"rest-model": createModelInfo(),
		}

		const { result } = renderHook(() => useGroupedModelIds(models))

		expect(result.current.preferredModelIds).toEqual(["pref-model"])
		expect(result.current.restModelIds).toEqual(["rest-model"])
	})

	it("memoizes result when models don't change", () => {
		const models: Record<string, ModelInfo> = {
			"model-a": createModelInfo(),
		}

		const { result, rerender } = renderHook(() => useGroupedModelIds(models))
		const firstResult = result.current

		rerender()
		const secondResult = result.current

		expect(firstResult).toBe(secondResult)
	})
})
