import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect, useCallback } from "react"
import {
	configAtom,
	configLoadingAtom,
	configErrorAtom,
	providerAtom,
	providersAtom,
	loadConfigAtom,
	saveConfigAtom,
	selectProviderAtom,
	addProviderAtom,
	updateProviderAtom,
	removeProviderAtom,
	mappedExtensionStateAtom,
} from "../atoms/config.js"
import { updatePartialExtensionStateAtom } from "../atoms/extension.js"
import { syncConfigToExtensionEffectAtom } from "../atoms/config-sync.js"
import type { CLIConfig, ProviderConfig } from "../../config/types.js"

export interface UseConfigReturn {
	config: CLIConfig
	loading: boolean
	error: Error | null
	provider: ProviderConfig | undefined
	providers: ProviderConfig[]
	loadConfig: () => Promise<CLIConfig>
	saveConfig: (config?: CLIConfig) => Promise<void>
	selectProvider: (providerId: string) => Promise<void>
	addProvider: (provider: ProviderConfig) => Promise<void>
	updateProvider: (providerId: string, updates: Partial<ProviderConfig>) => Promise<void>
	removeProvider: (providerId: string) => Promise<void>
	syncWithExtension: () => void
}

export function useConfig(): UseConfigReturn {
	const [config] = useAtom(configAtom)
	const loading = useAtomValue(configLoadingAtom)
	const error = useAtomValue(configErrorAtom)
	const provider = useAtomValue(providerAtom)
	const providers = useAtomValue(providersAtom)
	const mappedState = useAtomValue(mappedExtensionStateAtom)

	const loadConfigAction = useSetAtom(loadConfigAtom)
	const saveConfigAction = useSetAtom(saveConfigAtom)
	const selectProviderAction = useSetAtom(selectProviderAtom)
	const addProviderAction = useSetAtom(addProviderAtom)
	const updateProviderAction = useSetAtom(updateProviderAtom)
	const removeProviderAction = useSetAtom(removeProviderAtom)
	const updateExtensionState = useSetAtom(updatePartialExtensionStateAtom)
	const syncConfigToExtension = useSetAtom(syncConfigToExtensionEffectAtom)

	// Sync config with extension state whenever it changes
	const syncWithExtension = useCallback(async () => {
		// Update local extension state atoms
		updateExtensionState(mappedState)
		// Sync to actual extension
		await syncConfigToExtension()
	}, [mappedState, updateExtensionState, syncConfigToExtension])

	// Auto-sync on config changes
	useEffect(() => {
		syncWithExtension()
	}, [config, syncWithExtension])

	return {
		config,
		loading,
		error,
		provider,
		providers,
		loadConfig: loadConfigAction,
		saveConfig: saveConfigAction,
		selectProvider: selectProviderAction,
		addProvider: addProviderAction,
		updateProvider: updateProviderAction,
		removeProvider: removeProviderAction,
		syncWithExtension,
	}
}
