// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import { z } from "zod"
import * as vscode from "vscode"
import EventEmitter from "events"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ApiStream } from "../transform/stream"
import pWaitFor from "p-wait-for"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { buildApiHandler } from "../index"
import { virtualQuotaFallbackProfileDataSchema } from "../../../packages/types/src/provider-settings"
import { OpenRouterHandler } from "./openrouter"
import { UsageTracker } from "../../utils/usage-tracker"
import { type UsageWindow } from "@roo-code/types"

type VirtualQuotaFallbackProfile = z.infer<typeof virtualQuotaFallbackProfileDataSchema>

interface HandlerConfig {
	handler: ApiHandler
	profileId: string
	config: VirtualQuotaFallbackProfile
}

/**
 * Virtual Quota Fallback Provider API processor.
 * This handler is designed to call other API handlers with automatic fallback when quota limits are reached.
 */
export class VirtualQuotaFallbackHandler extends EventEmitter implements ApiHandler {
	private settingsManager: ProviderSettingsManager
	private settings: ProviderSettings

	private handlerConfigs: HandlerConfig[] = []
	private activeHandler: ApiHandler | undefined
	private activeProfileId: string | undefined
	private usage: UsageTracker
	private isInitialized: boolean = false

	constructor(options: ProviderSettings) {
		super()
		this.settings = options
		this.settingsManager = new ProviderSettingsManager(ContextProxy.instance.rawContext)
		this.usage = UsageTracker.getInstance()
	}

	async initialize(): Promise<void> {
		if (!this.isInitialized) {
			try {
				await this.loadConfiguredProfiles()
				this.isInitialized = true
			} catch (error) {
				console.error("Failed to initialize VirtualQuotaFallbackHandler:", error)
				throw error
			}
		}
	}

	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			await this.adjustActiveHandler("Count Tokens")

			if (!this.activeHandler) {
				return 0
			}

			return this.activeHandler.countTokens(content)
		} catch (error) {
			console.error("Error in countTokens:", error)
			throw error
		}
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		try {
			await this.initialize()
			await this.adjustActiveHandler("Message Call")

			if (!this.activeHandler || !this.activeProfileId) {
				throw new Error("All configured providers are unavailable or over limits.")
			}

			await this.usage.consume(this.activeProfileId, "requests", 1)

			const stream = this.activeHandler.createMessage(systemPrompt, messages, metadata)
			try {
				for await (const chunk of stream) {
					if (chunk.type === "usage") {
						const totalTokens = (chunk.inputTokens || 0) + (chunk.outputTokens || 0)
						if (totalTokens > 0) {
							await this.usage.consume(this.activeProfileId, "tokens", totalTokens)
						}
					}
					yield chunk
				}
			} catch (error) {
				// Check if this is a retryable
				if (this.isRateLimitError(error) || this.isOverloadError(error)) {
					// Set cooldown for the current provider
					await this.usage.setCooldown(this.activeProfileId, 10 * 60 * 1000)

					// Switch to a different provider
					await this.adjustActiveHandler("Retryable Error")

					// Retry the request with the new provider
					yield* this.createMessage(systemPrompt, messages, metadata)
					return
				}

				// For non-rate limit errors, set cooldown and rethrow
				await this.usage.setCooldown(this.activeProfileId, 10 * 60 * 1000)
				throw error
			}
		} catch (error) {
			console.error("Error in createMessage:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		// This is a synchronous method, so we can't await adjustActiveHandler here.
		// The handler should be adjusted before this method is called.
		if (!this.activeHandler) {
			return {
				id: "",
				info: {
					maxTokens: 1,
					contextWindow: 1,
					supportsPromptCache: false,
				},
			}
		}
		return this.activeHandler.getModel()
	}

	get contextWindow(): number {
		if (!this.activeHandler) {
			return 1 // Default fallback
		}
		const model = this.activeHandler.getModel()
		return model.info.contextWindow
	}

	private async loadConfiguredProfiles(): Promise<void> {
		this.handlerConfigs = []

		const profiles = this.settings.profiles || []
		if (profiles.length === 0) {
			console.warn("No profiles configured for VirtualQuotaFallbackHandler")
			return
		}

		console.debug(`Loading ${profiles.length} profiles for VirtualQuotaFallbackHandler`)

		const handlerConfigs: HandlerConfig[] = []

		for (let i = 0; i < profiles.length; i++) {
			const profile = profiles[i]
			if (!profile?.profileId || !profile?.profileName) {
				console.warn(`Skipping invalid profile at index ${i}:`, profile)
				continue
			}

			try {
				console.debug(
					`Loading profile ${i + 1}/${profiles.length}: ${profile.profileName} (${profile.profileId})`,
				)

				const profileSettings = await this.settingsManager.getProfile({ id: profile.profileId })
				const apiHandler = buildApiHandler(profileSettings)

				if (apiHandler) {
					// Only fetch model for OpenRouterHandler if it has the method
					if (apiHandler instanceof OpenRouterHandler && typeof apiHandler.fetchModel === "function") {
						try {
							await apiHandler.fetchModel()
						} catch (error) {
							console.warn(`Failed to fetch model for profile ${profile.profileName}:`, error)
							// Continue with the handler even if fetchModel fails
						}
					}

					handlerConfigs.push({
						handler: apiHandler,
						profileId: profile.profileId,
						config: profile,
					})

					console.debug(`Successfully loaded profile: ${profile.profileName}`)
				} else {
					console.warn(`Failed to create API handler for profile: ${profile.profileName}`)
				}
			} catch (error) {
				console.error(`❌ Failed to load profile ${i + 1} (${profile.profileName}):`, error)
			}
		}

		this.handlerConfigs = handlerConfigs
		console.debug(`Loaded ${this.handlerConfigs.length} profiles for VirtualQuotaFallbackHandler`)

		await this.adjustActiveHandler("Initial Config")
	}

	async adjustActiveHandler(reason?: string): Promise<void> {
		console.debug(`VirtualQuotaFallbackHandler:adjustActiveHandler(): ${reason}`)
		if (this.handlerConfigs.length === 0) {
			this.activeHandler = undefined
			this.activeProfileId = undefined
			return
		}

		// Check if we already have a valid active handler
		if (this.activeHandler && this.activeProfileId) {
			const currentConfig = this.handlerConfigs.find((c) => c.profileId === this.activeProfileId)
			if (currentConfig) {
				const isUnderCooldown = await this.usage.isUnderCooldown(this.activeProfileId)
				if (!isUnderCooldown && this.underLimit(currentConfig.config)) {
					console.debug(`VirtualQuotaFallbackHandler:adjustActiveHandler() No Change: ${reason}`)
					// Current handler is still valid, no need to switch
					return
				}
			}
		}

		// Find a new handler
		for (const { handler, profileId, config } of this.handlerConfigs) {
			const isUnderCooldown = await this.usage.isUnderCooldown(profileId)
			if (isUnderCooldown) {
				console.info(`VirtualQuotaFallbackHandler:adjustActiveHandler() UnderCooldown: Profile: ${profileId}`)
				continue
			}

			const isUnderLimit = this.underLimit(config)
			if (!isUnderLimit) {
				console.debug(`VirtualQuotaFallbackHandler:adjustActiveHandler() isUnderLimit: ${config}`)
				continue
			}

			if (this.activeHandler !== handler || this.activeProfileId !== profileId) {
				await this.notifyHandlerSwitch(profileId, reason)
			}
			this.activeHandler = handler
			this.activeProfileId = profileId
			this.emit("handlerChanged", this.activeHandler)
			return
		}

		// No valid handler found
		if (this.activeProfileId) {
			await this.notifyHandlerSwitch(undefined, "No Valid Provider")
		}
		this.activeHandler = undefined
		this.activeProfileId = undefined
		this.emit("handlerChanged", this.activeHandler)
	}

	private async notifyHandlerSwitch(newProfileId: string | undefined, reason?: string): Promise<void> {
		let message: string
		if (newProfileId) {
			try {
				const profile = await this.settingsManager.getProfile({ id: newProfileId })
				const providerName = profile.name
				message = `Switched active provider to: ${providerName}`
			} catch (error) {
				console.warn(`Failed to get provider name for ${newProfileId}:`, error)
				message = `Switched active provider to an unknown profile (ID: ${newProfileId})`
			}
		} else {
			message = "No active provider available. All configured providers are unavailable or over limits."
		}
		message = `${message}${reason ? " Reason: " + reason : ""}`
		vscode.window.showInformationMessage(message)
	}

	private isRateLimitError(error: any): boolean {
		// Check if error is a rate limit error (429)
		return (
			error?.status === 429 ||
			error?.response?.status === 429 ||
			error?.code === 429 ||
			(error?.message && error.message.toLowerCase().includes("rate limit")) ||
			(error?.response?.data?.error?.type && error.response.data.error.type.includes("rate_limit"))
		)
	}
	private isOverloadError(error: any): boolean {
		// Check if error is a 503
		return (
			error?.status === 503 ||
			error?.response?.status === 503 ||
			error?.code === 503 ||
			(error?.message && error.message.toLowerCase().includes("503")) ||
			(error?.response?.data?.error?.type && error.response.data.error.type.includes("503"))
		)
	}

	underLimit(profileData: VirtualQuotaFallbackProfile): boolean {
		const { profileId, profileLimits: limits } = profileData

		if (!profileId) {
			return false
		}

		if (!limits) {
			return true
		}
		const timeWindows: Array<{ window: UsageWindow; requests?: number; tokens?: number }> = [
			{ window: "minute", requests: limits.requestsPerMinute, tokens: limits.tokensPerMinute },
			{ window: "hour", requests: limits.requestsPerHour, tokens: limits.tokensPerHour },
			{ window: "day", requests: limits.requestsPerDay, tokens: limits.tokensPerDay },
		]

		for (const { window, requests: requestLimit, tokens: tokenLimit } of timeWindows) {
			if (requestLimit || tokenLimit) {
				const usage = this.usage.getUsage(profileId, window)

				if (requestLimit && usage.requests >= requestLimit) {
					return false
				}

				if (tokenLimit && usage.tokens >= tokenLimit) {
					return false
				}
			}
		}

		return true
	}
}
