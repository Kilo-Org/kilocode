import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { ApiStreamChunk } from "../../api/transform/stream"

export class GhostModel {
	private apiHandler: ApiHandler

	constructor(apiHandler: ApiHandler) {
		this.apiHandler = apiHandler
	}

	/**
	 * Factory method to create GhostModel from API config ID
	 */
	static async createFromApiConfig(
		apiConfigId: string,
		providerSettingsManager: ProviderSettingsManager,
	): Promise<GhostModel> {
		const apiProfile = await providerSettingsManager.getProfile({ id: apiConfigId })
		const apiHandler = buildApiHandler(apiProfile)

		if (apiHandler instanceof OpenRouterHandler) {
			await apiHandler.fetchModel()
		}

		return new GhostModel(apiHandler)
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
}
