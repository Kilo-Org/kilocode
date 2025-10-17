import { useMemo } from "react"
import type { ModelInfo } from "@roo-code/types"

export const usePreferredModels = (models: Record<string, ModelInfo> | null) => {
	return useMemo(() => {
		if (!models) return []

		const preferredModelIds = []
		const restModelIds = []
		// first add the preferred models
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

		// then add the rest
		for (const [key] of Object.entries(models)) {
			if (!preferredModelIds.includes(key)) {
				restModelIds.push(key)
			}
		}
		restModelIds.sort((a, b) => a.localeCompare(b))

		return [...preferredModelIds, ...restModelIds]
	}, [models])
}
