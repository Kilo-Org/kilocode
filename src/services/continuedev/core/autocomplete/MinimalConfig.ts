/**
 * Minimal configuration for autocomplete and NextEdit features.
 * This replaces the complex ConfigHandler system with simple hardcoded defaults.
 *
 * Analysis of ConfigHandler usage:
 * - CompletionProvider needs: config.tabAutocompleteOptions, config.experimental.enableStaticContextualization, currentProfile.profileType
 * - NextEditProvider needs: config.tabAutocompleteOptions, currentProfile.profileType
 * - NextEdit context fetching needs: config.modelsByRole, config.selectedModelByRole
 *
 * The profileType is only used for logging/telemetry, so we can set it to undefined for a minimal extraction.
 */

import { ILLM, TabAutocompleteOptions } from "../index.js"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../util/parameters.js"

interface MinimalConfig {
	tabAutocompleteOptions?: TabAutocompleteOptions
	experimental?: {
		enableStaticContextualization?: boolean
	}
	// Minimal model selection support for NextEdit context fetching
	modelsByRole?: {
		autocomplete?: ILLM[]
	}
	selectedModelByRole?: {
		autocomplete?: ILLM
		edit?: ILLM
		chat?: ILLM
		rerank?: ILLM
	}
	rules?: unknown[]
}

interface MinimalProfile {
	profileDescription: {
		profileType?: "control-plane" | "local" | "platform"
	}
}

/**
 * Default configuration with hardcoded values suitable for autocomplete/NextEdit.
 * Uses the same defaults from DEFAULT_AUTOCOMPLETE_OPTS.
 */
const DEFAULT_MINIMAL_CONFIG: MinimalConfig = {
	tabAutocompleteOptions: {
		...DEFAULT_AUTOCOMPLETE_OPTS,
	},
	experimental: {
		enableStaticContextualization: false,
	},
	modelsByRole: {
		autocomplete: [],
	},
	selectedModelByRole: {
		autocomplete: undefined,
	},
}

/**
 * Simple config provider that replaces ConfigHandler for autocomplete/NextEdit.
 * Returns hardcoded configuration without dependencies on control-plane.
 */
export class MinimalConfigProvider {
	private config: MinimalConfig
	public currentProfile: MinimalProfile | undefined

	constructor(config?: Partial<MinimalConfig>) {
		this.config = {
			...DEFAULT_MINIMAL_CONFIG,
			...config,
			tabAutocompleteOptions: {
				...DEFAULT_AUTOCOMPLETE_OPTS,
				...config?.tabAutocompleteOptions,
			} as TabAutocompleteOptions,
			experimental: {
				...DEFAULT_MINIMAL_CONFIG.experimental,
				...config?.experimental,
			},
		}

		// Set a minimal profile for logging purposes
		// In a minimal extraction, we don't have a control-plane profile
		this.currentProfile = undefined
	}

	/**
	 * Returns the config in the same shape as ConfigHandler.loadConfig()
	 * This maintains API compatibility with existing code.
	 */
	async loadConfig(): Promise<{ config: MinimalConfig }> {
		return { config: this.config }
	}

	/**
	 * Get autocomplete options directly
	 */
	getAutocompleteOptions(): TabAutocompleteOptions {
		return this.config.tabAutocompleteOptions || DEFAULT_AUTOCOMPLETE_OPTS
	}

	/**
	 * Check if static contextualization is enabled
	 */
	isStaticContextualizationEnabled(): boolean {
		return this.config.experimental?.enableStaticContextualization ?? false
	}

	/**
	 * Reload config (stub for compatibility)
	 */
	async reloadConfig(..._args: unknown[]): Promise<void> {
		// No-op for minimal config
	}

	/**
	 * Register config update handler (stub for compatibility)
	 */
	onConfigUpdate(_handler: (event: { config: MinimalConfig; configLoadInterrupted: boolean }) => void): void {
		// No-op for minimal config
	}

	/**
	 * Register custom context provider (stub for compatibility)
	 */
	registerCustomContextProvider(_provider: unknown): void {
		// No-op for minimal config
	}
}
