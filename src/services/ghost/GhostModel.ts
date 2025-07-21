import { GhostServiceSettings } from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { t } from "../../i18n"
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

		const stream = this.apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: userPrompt }] },
		])

		let response: string = ""
		let completionCost = 0
		try {
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					response += chunk.text
				} else if (chunk.type === "usage") {
					completionCost = chunk.totalCost ?? 0
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			response = ""
		}

		return response
	}
}
