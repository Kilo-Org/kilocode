import { GhostProfile } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { DEFAULT_GHOST_STRATEGY_ID, AVAILABLE_GHOST_STRATEGIES } from "../../shared/ghost-strategies"

const SUPPORTED_DEFAULT_PROVIDERS = ["mistral", "kilocode", "openrouter"]

export class GhostProfileManager {
	/**
	 * Create a Ghost Profile from settings - purely derived, not stored for now
	 * This creates profiles based on UI selections (apiConfigId + ghostStrategyId)
	 */
	static async createGhostProfileFromSettings(
		settings: { enableCustomProvider?: boolean; apiConfigId?: string; ghostStrategyId?: string },
		providerSettingsManager: ProviderSettingsManager,
	): Promise<GhostProfile> {
		const selectedStrategyId = settings.ghostStrategyId || DEFAULT_GHOST_STRATEGY_ID

		// Validate the Ghost Strategy ID
		const isValidStrategy = AVAILABLE_GHOST_STRATEGIES.some((s) => s.id === selectedStrategyId)
		if (!isValidStrategy) {
			console.warn(`Invalid Ghost Strategy ID: ${selectedStrategyId}, falling back to default`)
		}

		const strategyId = isValidStrategy ? selectedStrategyId : DEFAULT_GHOST_STRATEGY_ID

		// Custom mode: create profile from selected API config and Ghost Strategy ID
		if (settings?.enableCustomProvider && settings?.apiConfigId) {
			return {
				id: "custom",
				name: "Custom Provider",
				apiConfigId: settings.apiConfigId,
				strategyId: strategyId,
			}
		} else {
			// Default mode: auto-select best API config with default strategy
			const profiles = await providerSettingsManager.listConfig()
			const validProfiles = profiles
				.filter((x) => x.apiProvider && SUPPORTED_DEFAULT_PROVIDERS.includes(x.apiProvider))
				.sort((a, b) => {
					if (!a.apiProvider) {
						return 1 // Place undefined providers at the end
					}
					if (!b.apiProvider) {
						return -1 // Place undefined providers at the beginning
					}
					return (
						SUPPORTED_DEFAULT_PROVIDERS.indexOf(a.apiProvider) -
						SUPPORTED_DEFAULT_PROVIDERS.indexOf(b.apiProvider)
					)
				})

			const selectedProfile = validProfiles[0]
			if (!selectedProfile) {
				throw new Error("No valid API profiles found for ghost. Please configure an API provider.")
			}

			return {
				id: "default",
				name: `Auto-Selected (${selectedProfile.apiProvider})`,
				apiConfigId: selectedProfile.id,
				strategyId,
			}
		}
	}
}
