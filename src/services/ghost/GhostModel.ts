import { GhostServiceSettings } from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"

export class GhostModel {
	private apiHandler: ApiHandler | null = null
	private apiConfigId: string | null = null
	public loaded = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}

	public getApiConfigId() {
		return this.apiConfigId
	}

	public async reload(settings: GhostServiceSettings, providerSettingsManager: ProviderSettingsManager) {
		this.apiConfigId = settings?.apiConfigId || null
		const defaultApiConfigId = ContextProxy.instance?.getValues?.()?.currentApiConfigName || ""

		const profileQuery = this.apiConfigId
			? {
					id: this.apiConfigId,
				}
			: {
					name: defaultApiConfigId,
				}

		const profile = await providerSettingsManager.getProfile(profileQuery)
		this.apiHandler = buildApiHandler(profile)
		if (this.apiHandler instanceof OpenRouterHandler) {
			await this.apiHandler.fetchModel()
		}
		this.loaded = true
	}

	public async generateResponse(systemPrompt: string, userPrompt: string) {
		if (!this.apiHandler) {
			console.error("API handler is not initialized")
			throw new Error("API handler is not initialized. Please check your configuration.")
		}

		console.log("USED MODEL", this.apiHandler.getModel())

		const stream = this.apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: userPrompt }] },
		])

		let response: string = ""
		let cost = 0
		let inputTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let cacheWriteTokens = 0
		try {
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				} else if (chunk.type === "usage") {
					cost = chunk.totalCost ?? 0
					cacheReadTokens = chunk.cacheReadTokens ?? 0
					cacheWriteTokens = chunk.cacheWriteTokens ?? 0
					inputTokens = chunk.inputTokens ?? 0
					outputTokens = chunk.outputTokens ?? 0
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			response = ""
		}

		return {
			response,
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
