import { useMemo } from "react"
import type { ModelInfo } from "@roo-code/types"

// Result containing preferred and rest model IDs
export interface GroupedModelIds {
	preferredModelIds: string[]
	restModelIds: string[]
}

// Extracts and groups model IDs into preferred and rest categories
export const getGroupedModelIds = (models: Record<string, ModelInfo> | null): GroupedModelIds => {
	if (!models) {
		return { preferredModelIds: [], restModelIds: [] }
	}

	const preferredModelIds: string[] = []
	const restModelIds: string[] = []

	// First add the preferred models
	for (const [key, model] of Object.entries(models)) {
		if (Number.isInteger(model.preferredIndex)) {
			preferredModelIds.push(key)
		}
	}

	preferredModelIds.sort((a, b) => {
		const modelA = models[a]
		const modelB = models[b]
		return (modelA.preferredIndex ?? 0) - (modelB.preferredIndex ?? 0)
	})

	// Then add the rest
	for (const [key] of Object.entries(models)) {
		if (!preferredModelIds.includes(key)) {
			restModelIds.push(key)
		}
	}
	restModelIds.sort((a, b) => a.localeCompare(b))

	return {
		preferredModelIds,
		restModelIds,
	}
}

// Hook to get grouped model IDs with section metadata for sectioned dropdowns
export const useGroupedModelIds = (models: Record<string, ModelInfo> | null): GroupedModelIds => {
	return useMemo(() => getGroupedModelIds(models), [models])
}
