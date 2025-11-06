import {
	AutocompleteProviderKey,
	getKiloBaseUriFromToken,
	ProviderSettings,
	ProviderSettingsEntry,
} from "@roo-code/types"
import { ApiHandler } from "../../../api"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { ILLM, LLMOptions } from "../../continuedev/core/index.js"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../../continuedev/core/util/parameters.js"
import Mistral from "../../continuedev/core/llm/llms/Mistral"
import OpenRouter from "../../continuedev/core/llm/llms/OpenRouter"
import KiloCode from "../../continuedev/core/llm/llms/KiloCode"
import { GhostModel } from "../GhostModel"

export const AUTOCOMPLETE_PROVIDER_MODELS = {
	mistral: "codestral-2501",
	kilocode: "codestral-2501",
	openrouter: "mistralai/codestral-2501",
	bedrock: "mistral.codestral-2501-v1:0",
} as const

export class NewAutocompleteModel extends GhostModel {
	private profile: ProviderSettings | null = null

	constructor(apiHandler: ApiHandler | null = null) {
		super(apiHandler)
	}

	protected override cleanup(): void {
		super.cleanup()
		this.profile = null
	}

	public override async loadProfile(
		providerSettingsManager: ProviderSettingsManager,
		selectedProfile: ProviderSettingsEntry,
		provider: keyof typeof AUTOCOMPLETE_PROVIDER_MODELS,
	): Promise<void> {
		await super.loadProfile(providerSettingsManager, selectedProfile, provider)
		this.profile = await providerSettingsManager.getProfile({
			id: selectedProfile.id,
		})
	}

	/**
	 * Creates an ILLM-compatible instance from provider settings for autocomplete.
	 * Supports mistral, kilocode, openrouter, and bedrock providers.
	 * Uses the current profile loaded in this.profile.
	 *
	 * @returns ILLM instance or null if configuration is invalid
	 */
	public getILLM(): ILLM | null {
		if (!this.profile?.apiProvider) {
			console.warn("[NewAutocompleteModel] No profile loaded")
			return null
		}

		const provider = this.profile.apiProvider as AutocompleteProviderKey

		try {
			// Extract provider-specific configuration
			const config = this.extractProviderConfig()
			if (!config) {
				console.warn(`[NewAutocompleteModel] Failed to extract config for provider: ${provider}`)
				return null
			}

			// Build LLM options
			const llmOptions: LLMOptions = {
				model: config.model,
				apiKey: config.apiKey,
				apiBase: config.apiBase,
				contextLength: 32000, // Default for Codestral models
				completionOptions: {
					model: config.model,
					temperature: 0.2, // Lower temperature for more deterministic autocomplete
					maxTokens: 256, // Reasonable limit for code completions
				},
				autocompleteOptions: {
					...DEFAULT_AUTOCOMPLETE_OPTS,
					useCache: false, // Disable caching for autocomplete
				},
				uniqueId: `autocomplete-${provider}-${Date.now()}`,
				// Add env for KiloCode metadata (organizationId and tester suppression)
				env: {
					kilocodeTesterWarningsDisabledUntil: this.profile.kilocodeTesterWarningsDisabledUntil,
					kilocodeOrganizationId: config.organizationId,
				},
			}

			// Create appropriate LLM instance based on provider
			return this.createLLMInstance(provider, llmOptions)
		} catch (error) {
			console.error(`[NewAutocompleteModel] Error creating ILLM for provider ${provider}:`, error)
			return null
		}
	}

	/**
	 * Extracts provider-specific configuration (API key, base URL, model) from this.profile
	 */
	private extractProviderConfig(): {
		apiKey: string
		apiBase: string
		model: string
		organizationId?: string
	} | null {
		if (!this.profile?.apiProvider) {
			return null
		}

		const provider = this.profile.apiProvider as AutocompleteProviderKey
		const model = AUTOCOMPLETE_PROVIDER_MODELS[provider]

		switch (provider) {
			case "mistral":
				if (!this.profile.mistralApiKey) {
					console.warn("[NewAutocompleteModel] Missing Mistral API key")
					return null
				}
				return {
					apiKey: this.profile.mistralApiKey,
					apiBase: this.profile.mistralCodestralUrl || "https://codestral.mistral.ai/v1/",
					model,
				}

			case "kilocode":
				if (!this.profile.kilocodeToken) {
					console.warn("[NewAutocompleteModel] Missing Kilocode token")
					return null
				}
				return {
					apiKey: this.profile.kilocodeToken,
					apiBase: `${getKiloBaseUriFromToken(this.profile.kilocodeToken)}/api/openrouter/v1`,
					model,
					organizationId: this.profile.kilocodeOrganizationId,
				}

			case "openrouter":
				if (!this.profile.openRouterApiKey) {
					console.warn("[NewAutocompleteModel] Missing OpenRouter API key")
					return null
				}
				return {
					apiKey: this.profile.openRouterApiKey,
					apiBase: this.profile.openRouterBaseUrl || "https://openrouter.ai/api/v1",
					model,
				}

			case "bedrock":
				// Bedrock uses AWS credentials, not a simple API key
				// For now, return null as it requires more complex setup
				console.warn("[NewAutocompleteModel] Bedrock provider not yet supported for autocomplete")
				return null

			default:
				console.warn(`[NewAutocompleteModel] Unsupported provider: ${provider}`)
				return null
		}
	}

	/**
	 * Creates the appropriate LLM instance based on provider type
	 */
	private createLLMInstance(provider: AutocompleteProviderKey, options: LLMOptions): ILLM | null {
		switch (provider) {
			case "mistral":
				return new Mistral(options)

			case "kilocode":
				// Use dedicated KiloCode class with custom headers and routing
				// Pass the existing apiHandler as fimProvider if available
				return new KiloCode({
					...options,
					fimProvider: this.apiHandler || undefined,
				})

			case "openrouter":
				// Use standard OpenRouter
				return new OpenRouter(options)

			case "bedrock":
				// Bedrock would need a custom implementation
				return null

			default:
				return null
		}
	}
}
