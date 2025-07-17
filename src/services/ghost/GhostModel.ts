import { ApiHandler, buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { t } from "../../i18n"

export class GhostModel {
	private apiHandler: ApiHandler | null = null
	private modelName: string = "google/gemini-2.5-flash"

	constructor() {
		const kilocodeToken = ContextProxy.instance.getProviderSettings().kilocodeToken

		if (kilocodeToken) {
			this.apiHandler = buildApiHandler({
				apiProvider: "kilocode",
				kilocodeToken,
				kilocodeModel: this.modelName,
			})
		}
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
