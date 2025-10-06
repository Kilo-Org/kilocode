import { GhostServiceSettings } from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { ApiStreamChunk } from "../../api/transform/stream"

const KILOCODE_DEFAULT_MODEL = "mistralai/codestral-2508"
const MISTRAL_DEFAULT_MODEL = "codestral-latest"

const SUPPORTED_DEFAULT_PROVIDERS = ["mistral", "kilocode", "openrouter"]

export class GhostModel {
	private apiHandler: ApiHandler | null = null
	public loaded = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}

	public async reload(settings: GhostServiceSettings, providerSettingsManager: ProviderSettingsManager) {
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

		const selectedProfile = validProfiles[0] || null
		if (selectedProfile) {
			const profile = await providerSettingsManager.getProfile({
				id: selectedProfile.id,
			})
			const profileProvider = profile.apiProvider
			let modelDefinition = {}
			if (profileProvider === "kilocode") {
				modelDefinition = {
					kilocodeModel: KILOCODE_DEFAULT_MODEL,
				}
			} else if (profileProvider === "openrouter") {
				modelDefinition = {
					openRouterModelId: KILOCODE_DEFAULT_MODEL,
				}
			} else if (profileProvider === "mistral") {
				modelDefinition = {
					apiModelId: MISTRAL_DEFAULT_MODEL,
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
