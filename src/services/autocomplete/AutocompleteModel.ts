import {
	AUTOCOMPLETE_PROVIDER_MODELS,
	AutocompleteProviderKey,
	defaultProviderUsabilityChecker,
	getKiloBaseUriFromToken,
	modelIdKeysByProvider,
	ProviderSettings,
	ProviderSettingsEntry,
} from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { ApiStreamChunk } from "../../api/transform/stream"
import { ILLM, LLMOptions } from "../continuedev/core/index.js"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../continuedev/core/util/parameters.js"
import Mistral from "../continuedev/core/llm/llms/Mistral"
import { OpenAI } from "../continuedev/core/llm/llms/OpenAI"

export class AutocompleteModel {
	private apiHandler: ApiHandler | null = null
	private profile: ProviderSettings | null = null
	public loaded = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}
	private cleanup(): void {
		this.apiHandler = null
		this.profile = null
		this.loaded = false
	}

	public async reload(providerSettingsManager: ProviderSettingsManager): Promise<boolean> {
		const profiles = await providerSettingsManager.listConfig()
		const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS) as Array<
			keyof typeof AUTOCOMPLETE_PROVIDER_MODELS
		>

		this.cleanup()

		// Check providers in order, but skip unusable ones (e.g., kilocode with zero balance)
		for (const provider of supportedProviders) {
			const selectedProfile = profiles.find(
				(x): x is typeof x & { apiProvider: string } => x?.apiProvider === provider,
			)
			if (selectedProfile) {
				const isUsable = await defaultProviderUsabilityChecker(provider, providerSettingsManager)
				if (!isUsable) continue

				this.loadProfile(providerSettingsManager, selectedProfile, provider)
				this.loaded = true
				return true
			}
		}

		this.loaded = true // we loaded, and found nothing, but we do not wish to reload
		return false
	}

	public async loadProfile(
		providerSettingsManager: ProviderSettingsManager,
		selectedProfile: ProviderSettingsEntry,
		provider: keyof typeof AUTOCOMPLETE_PROVIDER_MODELS,
	): Promise<void> {
		this.profile = await providerSettingsManager.getProfile({
			id: selectedProfile.id,
		})

		this.apiHandler = buildApiHandler({
			...this.profile,
			[modelIdKeysByProvider[provider]]: AUTOCOMPLETE_PROVIDER_MODELS[provider],
		})

		if (this.apiHandler instanceof OpenRouterHandler) {
			await this.apiHandler.fetchModel()
		}
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
			console.warn("[AutocompleteModel] No profile loaded")
			return null
		}

		const provider = this.profile.apiProvider as AutocompleteProviderKey

		try {
			// Extract provider-specific configuration
			const config = this.extractProviderConfig()
			if (!config) {
				console.warn(`[AutocompleteModel] Failed to extract config for provider: ${provider}`)
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
			}

			// Create appropriate LLM instance based on provider
			return this.createLLMInstance(provider, llmOptions)
		} catch (error) {
			console.error(`[AutocompleteModel] Error creating ILLM for provider ${provider}:`, error)
			return null
		}
	}

	/**
	 * Extracts provider-specific configuration (API key, base URL, model) from this.profile
	 */
	private extractProviderConfig(): { apiKey: string; apiBase: string; model: string } | null {
		if (!this.profile?.apiProvider) {
			return null
		}

		const provider = this.profile.apiProvider as AutocompleteProviderKey
		const model = AUTOCOMPLETE_PROVIDER_MODELS[provider]

		switch (provider) {
			case "mistral":
				if (!this.profile.mistralApiKey) {
					console.warn("[AutocompleteModel] Missing Mistral API key")
					return null
				}
				return {
					apiKey: this.profile.mistralApiKey,
					apiBase: this.profile.mistralCodestralUrl || "https://codestral.mistral.ai/v1/",
					model,
				}

			case "kilocode":
				if (!this.profile.kilocodeToken) {
					console.warn("[AutocompleteModel] Missing Kilocode token")
					return null
				}
				return {
					apiKey: this.profile.kilocodeToken,
					apiBase: `${getKiloBaseUriFromToken(this.profile.kilocodeToken)}/openrouter/api/v1`,
					model,
				}

			case "openrouter":
				if (!this.profile.openRouterApiKey) {
					console.warn("[AutocompleteModel] Missing OpenRouter API key")
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
				console.warn("[AutocompleteModel] Bedrock provider not yet supported for autocomplete")
				return null

			default:
				console.warn(`[AutocompleteModel] Unsupported provider: ${provider}`)
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
			case "openrouter":
				// Both use OpenAI-compatible API
				return new OpenAI(options)

			case "bedrock":
				// Bedrock would need a custom implementation
				return null

			default:
				return null
		}
	}

	/**
	 * Generate response with streaming callback support
	 */
	public async generateResponse(
		systemPrompt: string,
		userPrompt: string,
		onChunk: (chunk: ApiStreamChunk) => void,
	): Promise<{
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}> {
		if (!this.apiHandler) {
			console.error("API handler is not initialized")
			throw new Error("API handler is not initialized. Please check your configuration.")
		}

		console.log("USED MODEL", this.apiHandler.getModel())

		const stream = this.apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: userPrompt }] },
		])

		let cost = 0
		let inputTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let cacheWriteTokens = 0

		try {
			for await (const chunk of stream) {
				// Call the callback with each chunk
				onChunk(chunk)

				// Track usage information
				if (chunk.type === "usage") {
					cost = chunk.totalCost ?? 0
					cacheReadTokens = chunk.cacheReadTokens ?? 0
					cacheWriteTokens = chunk.cacheWriteTokens ?? 0
					inputTokens = chunk.inputTokens ?? 0
					outputTokens = chunk.outputTokens ?? 0
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			throw error
		}

		return {
			cost,
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
		}
	}

	public getModelName(): string | null {
		if (!this.apiHandler) return null

		return this.apiHandler.getModel().id ?? "unknown"
	}

	public getProviderDisplayName(): string | null {
		if (!this.apiHandler) return null

		const handler = this.apiHandler as any
		if (handler.providerName && typeof handler.providerName === "string") {
			return handler.providerName
		} else {
			return "unknown"
		}
	}

	public hasValidCredentials(): boolean {
		return this.apiHandler !== null && this.loaded
	}
}
