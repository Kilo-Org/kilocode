import { atom } from "jotai"

const STORAGE_KEY = "agentManager.selectedModelId"

/**
 * Model information returned from CLI models command
 */
export interface AvailableModel {
	id: string
	displayName: string | null
	contextWindow: number
	supportsImages?: boolean
	inputPrice?: number
	outputPrice?: number
}

/**
 * Provider and model configuration from CLI
 */
export interface ModelsConfig {
	provider: string
	currentModel: string
	models: AvailableModel[]
}

/**
 * Whether models are currently being loaded from CLI.
 * Starts as true since we fetch models on panel open.
 */
export const modelsLoadingAtom = atom<boolean>(true)

/**
 * Available models fetched from CLI via `kilocode models --json`.
 * This is workspace-level state (not session-specific) because the provider
 * configuration is shared across all sessions.
 */
export const modelsConfigAtom = atom<ModelsConfig | null>(null)

/**
 * Helper to get persisted model ID from localStorage
 */
function getPersistedModelId(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY)
	} catch (error) {
		console.error("[AgentManager] Failed to read model selection from localStorage:", error)
		return null
	}
}

/**
 * Helper to persist model ID to localStorage
 */
function persistModelId(modelId: string | null): void {
	try {
		if (modelId) {
			localStorage.setItem(STORAGE_KEY, modelId)
		} else {
			localStorage.removeItem(STORAGE_KEY)
		}
	} catch (error) {
		console.error("[AgentManager] Failed to persist model selection to localStorage:", error)
	}
}

/**
 * Currently selected model for new sessions.
 * Initialized from localStorage if available.
 * Defaults to currentModel from CLI if not explicitly set.
 */
export const selectedModelIdAtom = atom<string | null>(getPersistedModelId())

/**
 * Derived atom: the effective model ID to use for new sessions.
 * Returns selectedModelIdAtom if set, otherwise currentModel from modelsConfigAtom.
 */
export const effectiveModelIdAtom = atom((get) => {
	const selected = get(selectedModelIdAtom)
	if (selected) return selected

	const config = get(modelsConfigAtom)
	return config?.currentModel ?? null
})

/**
 * Action atom to update the models configuration from extension message.
 * Also sets loading to false when models are received.
 * Validates persisted model selection against available models.
 */
export const updateModelsConfigAtom = atom(
	null,
	(get, set, payload: { provider: string; currentModel: string; models: AvailableModel[] }) => {
		set(modelsConfigAtom, payload)
		set(modelsLoadingAtom, false)

		// Validate persisted selection - clear if model no longer exists
		const currentSelection = get(selectedModelIdAtom)
		if (currentSelection) {
			const modelExists = payload.models.some((m) => m.id === currentSelection)
			if (!modelExists) {
				// Clear invalid persisted selection
				set(selectedModelIdAtom, null)
				persistModelId(null)
			}
		}
	},
)

/**
 * Action atom to handle model loading failure.
 * Sets loading to false so UI exits loading state.
 */
export const modelsLoadFailedAtom = atom(null, (_get, set, _error?: string) => {
	set(modelsLoadingAtom, false)
	// Keep modelsConfigAtom as null - UI will show nothing for model selector
})

/**
 * Action atom to set selected model ID with localStorage persistence
 */
export const setSelectedModelIdAtom = atom(null, (_get, set, modelId: string | null) => {
	set(selectedModelIdAtom, modelId)
	persistModelId(modelId)
})
