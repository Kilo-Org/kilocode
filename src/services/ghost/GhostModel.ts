import { modelIdKeysByProvider, ProviderSettingsEntry } from "@roo-code/types"
import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { CompletionUsage } from "../../api/providers/openrouter"
import { ApiStreamChunk } from "../../api/transform/stream"
import { AUTOCOMPLETE_PROVIDER_MODELS, checkKilocodeBalance } from "./utils/kilocode-utils"
import { KilocodeOpenrouterHandler } from "../../api/providers/kilocode-openrouter"

export class GhostModel {
	private apiHandler: ApiHandler | null = null
	public loaded = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}
	private cleanup(): void {
		this.apiHandler = null
		this.loaded = false
	}

	public async reload(providerSettingsManager: ProviderSettingsManager): Promise<boolean> {
		const profiles = await providerSettingsManager.listConfig()

		this.cleanup()

		// Check providers in order, but skip unusable ones (e.g., kilocode with zero balance)
		for (const [provider, model] of AUTOCOMPLETE_PROVIDER_MODELS) {
			const selectedProfile = profiles.find((x) => x?.apiProvider === provider)
			if (!selectedProfile) continue
			const profile = await providerSettingsManager.getProfile({ id: selectedProfile.id })

			if (provider === "kilocode") {
				// For all other providers, assume they are usable
				if (!profile.kilocodeToken) continue
				if (!(await checkKilocodeBalance(profile.kilocodeToken, profile.kilocodeOrganizationId))) continue
			}

			this.apiHandler = buildApiHandler({ ...profile, [modelIdKeysByProvider[provider]]: model })

			if (this.apiHandler instanceof OpenRouterHandler) {
				await this.apiHandler.fetchModel()
			}
			this.loaded = true
			return true
		}

		this.loaded = true // we loaded, and found nothing, but we do not wish to reload
		return false
	}

	public supportsFim(): boolean {
		if (!this.apiHandler) {
			return false
		}

		if (this.apiHandler instanceof KilocodeOpenrouterHandler) {
			return this.apiHandler.supportsFim()
		}

		return false
	}

	/**
	 * Generate FIM completion using the FIM API endpoint
	 */
	public async generateFimResponse(
		prefix: string,
		suffix: string,
		onChunk: (text: string) => void,
		taskId?: string,
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

		if (!(this.apiHandler instanceof KilocodeOpenrouterHandler)) {
			throw new Error("FIM is only supported for KiloCode provider")
		}

		if (!this.apiHandler.supportsFim()) {
			throw new Error("Current model does not support FIM completions")
		}

		console.log("USED MODEL (FIM)", this.apiHandler.getModel())

		let usage: CompletionUsage | undefined

		try {
			for await (const chunk of this.apiHandler.streamFim(prefix, suffix, taskId)) {
				if (chunk.type === "content") {
					onChunk(chunk.content)
				} else if (chunk.type === "usage") {
					usage = chunk.usage
				}
			}
		} catch (error) {
			console.error("Error streaming FIM completion:", error)
			throw error
		}

		// Calculate cost from usage information
		const cost = usage ? this.apiHandler.getTotalCost(usage) : 0
		const inputTokens = usage?.prompt_tokens ?? 0
		const outputTokens = usage?.completion_tokens ?? 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0

		return {
			cost,
			inputTokens,
			outputTokens,
			cacheWriteTokens: 0, // FIM doesn't support cache writes
			cacheReadTokens,
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

	public getModelName(): string | undefined {
		if (!this.apiHandler) return undefined

		return this.apiHandler.getModel().id ?? undefined
	}

	public getProviderDisplayName(): string | undefined {
		if (!this.apiHandler) return undefined

		const handler = this.apiHandler as any
		if (handler.providerName && typeof handler.providerName === "string") {
			return handler.providerName
		} else {
			return undefined
		}
	}

	public hasValidCredentials(): boolean {
		return this.apiHandler !== null && this.loaded
	}
}
