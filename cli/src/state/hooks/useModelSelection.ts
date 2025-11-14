/**
 * Hook for managing model selection and provider settings
 * Provides access to available models, current configuration, and switching actions
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useMemo, useCallback } from "react"
import type { RouterModels, ProviderSettings, ProviderSettingsEntry } from "../../types/messages.js"
import {
	routerModelsAtom,
	apiConfigurationAtom,
	currentApiConfigNameAtom,
	listApiConfigMetaAtom,
} from "../atoms/extension.js"
import { sendApiConfigurationAtom, requestRouterModelsAtom } from "../atoms/actions.js"

/**
 * Return type for useModelSelection hook
 */
export interface UseModelSelectionReturn {
	/** Available router models */
	routerModels: RouterModels | null
	/** Current API configuration/provider settings */
	apiConfiguration: ProviderSettings | null
	/** Current API config profile name */
	currentConfigName: string | null
	/** List of available API config profiles */
	availableConfigs: ProviderSettingsEntry[]
	/** Current provider name */
	currentProvider: string | null
	/** Current model ID */
	currentModelId: string | null
	/** Send new API configuration */
	setApiConfiguration: (config: ProviderSettings) => Promise<void>
	/** Request router models from extension */
	refreshRouterModels: () => Promise<void>
	/** Check if a specific provider is configured */
	isProviderConfigured: (provider: string) => boolean
	/** Get model info by ID from router models */
	getModelInfo: (modelId: string) => unknown | null
}

/**
 * Hook for managing model selection and provider settings
 *
 * Provides access to the current model configuration, available models,
 * and actions for switching models or updating provider settings.
 *
 * @example
 * ```tsx
 * function ModelSelector() {
 *   const {
 *     apiConfiguration,
 *     currentProvider,
 *     currentModelId,
 *     setApiConfiguration,
 *     routerModels
 *   } = useModelSelection()
 *
 *   const handleModelChange = async (newModelId: string) => {
 *     await setApiConfiguration({
 *       ...apiConfiguration,
 *       apiModelId: newModelId
 *     })
 *   }
 *
 *   return (
 *     <div>
 *       <h3>Current: {currentProvider} - {currentModelId}</h3>
 *       <select onChange={e => handleModelChange(e.target.value)}>
 *         {routerModels?.models.map(model => (
 *           <option key={model.id} value={model.id}>
 *             {model.name}
 *           </option>
 *         ))}
 *       </select>
 *     </div>
 *   )
 * }
 * ```
 */
export function useModelSelection(): UseModelSelectionReturn {
	// Read atoms
	const routerModels = useAtomValue(routerModelsAtom)
	const apiConfiguration = useAtomValue(apiConfigurationAtom)
	const currentConfigName = useAtomValue(currentApiConfigNameAtom)
	const availableConfigs = useAtomValue(listApiConfigMetaAtom)

	// Write atoms
	const setApiConfigurationAction = useSetAtom(sendApiConfigurationAtom)
	const refreshRouterModelsAction = useSetAtom(requestRouterModelsAtom)

	// Derived values
	const currentProvider = useMemo(() => {
		return apiConfiguration?.apiProvider || null
	}, [apiConfiguration])

	const currentModelId = useMemo(() => {
		return apiConfiguration?.apiModelId || null
	}, [apiConfiguration])

	// Actions
	const setApiConfiguration = useCallback(
		async (config: ProviderSettings) => {
			await setApiConfigurationAction(config)
		},
		[setApiConfigurationAction],
	)

	const refreshRouterModels = useCallback(async () => {
		await refreshRouterModelsAction()
	}, [refreshRouterModelsAction])

	// Utility functions
	const isProviderConfigured = useCallback(
		(provider: string) => {
			if (!apiConfiguration) return false
			return apiConfiguration.apiProvider === provider
		},
		[apiConfiguration],
	)

	const getModelInfo = useCallback(
		(modelId: string) => {
			if (!routerModels) return null

			// Search through all routers
			for (const [routerName, models] of Object.entries(routerModels)) {
				if (routerName === "default") continue
				const modelRecord = models as Record<string, unknown>
				if (modelRecord[modelId]) {
					return modelRecord[modelId]
				}
			}

			return null
		},
		[routerModels],
	)

	// Memoize return value
	return useMemo(
		() => ({
			routerModels,
			apiConfiguration,
			currentConfigName,
			availableConfigs,
			currentProvider,
			currentModelId,
			setApiConfiguration,
			refreshRouterModels,
			isProviderConfigured,
			getModelInfo,
		}),
		[
			routerModels,
			apiConfiguration,
			currentConfigName,
			availableConfigs,
			currentProvider,
			currentModelId,
			setApiConfiguration,
			refreshRouterModels,
			isProviderConfigured,
			getModelInfo,
		],
	)
}
