import { AUTOCOMPLETE_PROVIDER_MODELS } from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { ApiStreamChunk } from "../../api/transform/stream"

export class GhostModel {
	private apiHandler: ApiHandler | null = null
	public loaded = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}

	public async reload(providerSettingsManager: ProviderSettingsManager) {
		const profiles = await providerSettingsManager.listConfig()
		const supportedProviders = Object.keys(AUTOCOMPLETE_PROVIDER_MODELS)
		const validProfiles = profiles
			.filter((x) => x.apiProvider && x.apiProvider in AUTOCOMPLETE_PROVIDER_MODELS)
			.sort((a, b) => {
				if (!a.apiProvider) {
					return 1
				}
				if (!b.apiProvider) {
					return -1
				}
				return supportedProviders.indexOf(a.apiProvider) - supportedProviders.indexOf(b.apiProvider)
			})

		const selectedProfile = validProfiles[0] || null
		if (selectedProfile) {
			const profile = await providerSettingsManager.getProfile({
				id: selectedProfile.id,
			})
			const profileProvider = profile.apiProvider
			let modelDefinition = {}
			if (profileProvider === "kilocode") {
				modelDefinition = {
					kilocodeModel: AUTOCOMPLETE_PROVIDER_MODELS.kilocode,
				}
			} else if (profileProvider === "openrouter") {
				modelDefinition = {
					openRouterModelId: AUTOCOMPLETE_PROVIDER_MODELS.openrouter,
				}
			} else if (profileProvider === "mistral") {
				modelDefinition = {
					apiModelId: AUTOCOMPLETE_PROVIDER_MODELS.mistral,
				}
			}
			this.apiHandler = buildApiHandler({
				...profile,
				...modelDefinition,
			})
		}

		if (this.apiHandler instanceof OpenRouterHandler) {
			await this.apiHandler.fetchModel()
		}

		this.loaded = true
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
		if (!this.apiHandler) {
			return null
		}
		// Extract model name from API handler
		return this.apiHandler.getModel().id ?? "unknown"
	}

	public hasValidCredentials(): boolean {
		return this.apiHandler !== null && this.loaded
	}
}
