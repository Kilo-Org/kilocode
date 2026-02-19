// kilocode_change new file
import { modelIdKeysByProvider, ProviderName } from "@roo-code/types"
import { ApiHandler, buildApiHandler, FimHandler } from "../../api"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { OpenRouterHandler } from "../../api/providers"
import { CompletionUsage } from "../../api/providers/openrouter"
import { ApiStreamChunk } from "../../api/transform/stream"
import { AUTOCOMPLETE_PROVIDER_MODELS, checkKilocodeBalance } from "./utils/kilocode-utils"
import { KilocodeOpenrouterHandler } from "../../api/providers/kilocode-openrouter"
import { PROVIDERS } from "../../../webview-ui/src/components/settings/constants"
import { ResponseMetaData } from "./types"

function getFimHandler(handler: ApiHandler): FimHandler | undefined {
	if (typeof handler.fimSupport === "function") {
		return handler.fimSupport()
	}
	return undefined
}

// Convert PROVIDERS array to a lookup map for display names
const PROVIDER_DISPLAY_NAMES = Object.fromEntries(PROVIDERS.map(({ value, label }) => [value, label])) as Record<
	ProviderName,
	string
>

export class AutocompleteModel {
	private apiHandler: ApiHandler | null = null
	public profileName: string | null = null
	public profileType: string | null = null
	private currentProvider: ProviderName | null = null
	public loaded = false
	public hasKilocodeProfileWithNoBalance = false

	constructor(apiHandler: ApiHandler | null = null) {
		if (apiHandler) {
			this.apiHandler = apiHandler
			this.loaded = true
		}
	}
	private cleanup(): void {
		this.apiHandler = null
		this.profileName = null
		this.profileType = null
		this.currentProvider = null
		this.loaded = false
		this.hasKilocodeProfileWithNoBalance = false
	}

	public async reload(providerSettingsManager: ProviderSettingsManager): Promise<boolean> {
		const profiles = await providerSettingsManager.listConfig()

		this.cleanup()

		const selectedProfile = profiles.find((x) => x.profileType === "autocomplete")
		if (selectedProfile) {
			const profile = await providerSettingsManager.getProfile({ id: selectedProfile.id })
			if (profile.apiProvider) {
				await useProfile(this, profile, profile.apiProvider)
				return true
			}
		}

		for (const [provider, model] of AUTOCOMPLETE_PROVIDER_MODELS) {
			const selectedProfile = profiles.find(
				(x) => x?.apiProvider === provider && !(x.profileType === "autocomplete"),
			)
			if (!selectedProfile) continue
			const profile = await providerSettingsManager.getProfile({ id: selectedProfile.id })

			if (provider === "kilocode") {
				// For all other providers, assume they are usable
				if (!profile.kilocodeToken) continue
				const hasBalance = await checkKilocodeBalance(profile.kilocodeToken, profile.kilocodeOrganizationId)
				if (!hasBalance) {
					// Track that we found a kilocode profile but it has no balance
					this.hasKilocodeProfileWithNoBalance = true
					continue
				}
			}
			await useProfile(this, { ...profile, [modelIdKeysByProvider[provider]]: model }, provider)
			return true
		}

		this.loaded = true // we loaded, and found nothing, but we do not wish to reload
		return false

		type ProfileWithIdAndName = Awaited<ReturnType<typeof providerSettingsManager.getProfile>>
		async function useProfile(self: AutocompleteModel, profile: ProfileWithIdAndName, provider: ProviderName) {
			self.profileName = profile.name || null
			self.profileType = profile.profileType || null
			self.currentProvider = provider
			self.apiHandler = buildApiHandler(profile)
			if (self.apiHandler instanceof OpenRouterHandler) await self.apiHandler.fetchModel()
			self.loaded = true
		}
	}

	public supportsFim(): boolean {
		if (!this.apiHandler) {
			return false
		}

		return getFimHandler(this.apiHandler) !== undefined
	}

	/**
	 * Generate FIM completion using the FIM API endpoint.
	 */
	public async generateFimResponse(
		prefix: string,
		suffix: string,
		onChunk: (text: string) => void,
		taskId?: string,
	): Promise<ResponseMetaData> {
		if (!this.apiHandler) {
			console.error("API handler is not initialized")
			throw new Error("API handler is not initialized. Please check your configuration.")
		}

		const fimHandler = getFimHandler(this.apiHandler)
		if (!fimHandler) {
			throw new Error("Current provider/model does not support FIM completions")
		}

		console.log("USED MODEL (FIM)", fimHandler.getModel())

		let usage: CompletionUsage | undefined

		for await (const chunk of fimHandler.streamFim(prefix, suffix, taskId, (u: CompletionUsage) => {
			usage = u
		})) {
			onChunk(chunk)
		}

		// Calculate cost using the FimHandler's getTotalCost method
		const cost = usage ? fimHandler.getTotalCost(usage) : 0
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
	): Promise<ResponseMetaData> {
		if (!this.apiHandler) {
			console.error("API handler is not initialized")
			throw new Error("API handler is not initialized. Please check your configuration.")
		}

		console.log("USED MODEL", this.apiHandler.getModel())

		// kilocode_change: pass feature metadata for microdollar usage tracking
		const stream = this.apiHandler.createMessage(
			systemPrompt,
			[{ role: "user", content: [{ type: "text", text: userPrompt }] }],
			{ taskId: "autocomplete", feature: "autocomplete" },
		)

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
		if (!this.currentProvider) return undefined
		return PROVIDER_DISPLAY_NAMES[this.currentProvider]
	}

	public getRolloutHash_IfLoggedInToKilo(): number | undefined {
		return this.apiHandler instanceof KilocodeOpenrouterHandler ? this.apiHandler.getRolloutHash() : undefined
	}

	public hasValidCredentials(): boolean {
		return this.apiHandler !== null && this.loaded
	}
}
