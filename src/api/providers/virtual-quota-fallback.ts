// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import { z } from "zod"
import * as vscode from "vscode"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ApiStream } from "../transform/stream"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { buildApiHandler } from "../index"
import { virtualQuotaFallbackProfileDataSchema } from "../../../packages/types/src/provider-settings"
import { UsageTracker, type UsageWindow } from "../../utils/usage-tracker"

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
export class VirtualQuotaFallbackHandler implements ApiHandler {
	private settingsManager: ProviderSettingsManager
	private settings: ProviderSettings

	private handlers: HandlerConfig[] = []
	private activeHandler: ApiHandler | undefined
	private activeProfileId: string | undefined
	private usage: UsageTracker
	private isInitialized: boolean = false

	constructor(options: ProviderSettings) {
		this.settings = options
		this.settingsManager = new ProviderSettingsManager(ContextProxy.instance.rawContext)
		this.usage = UsageTracker.initialize(ContextProxy.instance.rawContext)
		this.initialize()
	}

	/**
	 * Initialize the handler by loading configured profiles.
	 * Must be called after construction before using the handler.
	 */
	async initialize(): Promise<void> {
		if (!this.isInitialized) {
			await this.loadConfiguredProfiles()
			this.isInitialized = true
		}
	}

	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		await this.initialize()
		await this.adjustActiveHandler()
		return this.activeHandler?.countTokens(content) ?? 0
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.initialize()
		await this.adjustActiveHandler()

		if (!this.activeHandler || !this.activeProfileId) {
			throw new Error("No active handler configured - ensure profiles are available and properly configured")
		}

		// Get the provider name for the active handler
		let providerName = "unknown"
		try {
			const profile = await this.settingsManager.getProfile({ id: this.activeProfileId })
			providerName = profile.name
		} catch (error) {
			console.warn(`Failed to get provider name for ${this.activeProfileId}:`, error)
		}

		// Track request consumption - one request per createMessage call
		await this.usage.consume(this.activeProfileId, "requests", 1)

		// Intercept the stream to track token usage
		for await (const chunk of this.activeHandler.createMessage(systemPrompt, messages, metadata)) {
			// Track token consumption when we receive usage information
			if (chunk.type === "usage" && this.usage && this.activeProfileId) {
				try {
					const totalTokens = (chunk.inputTokens || 0) + (chunk.outputTokens || 0)
					if (totalTokens > 0) {
						await this.usage.consume(this.activeProfileId, "tokens", totalTokens)
					}
				} catch (error) {
					console.warn("Failed to track token consumption:", error)
				}
			}
			yield chunk
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		if (!this.activeHandler) {
			throw new Error("No active handler configured - ensure initialize() was called and profiles are available")
		}
		const model = this.activeHandler.getModel()
		return model
	}

	/**
	 * Loads and validates the configured profiles from settings
	 */
	private async loadConfiguredProfiles(): Promise<void> {
		this.handlers = []

		const profiles = this.settings.profiles || []
		const handlerPromises = profiles.map(async (profile, index) => {
			if (!profile?.profileId || !profile?.profileName) {
				return null
			}

			try {
				const profileSettings = await this.settingsManager.getProfile({ id: profile.profileId })
				const apiHandler = buildApiHandler(profileSettings)

				if (apiHandler) {
					return {
						handler: apiHandler,
						profileId: profile.profileId,
						config: profile,
					} as HandlerConfig
				}
			} catch (error) {
				console.error(`❌ Failed to load profile ${index + 1} (${profile.profileName}): ${error}`)
			}
			return null
		})

		const results = await Promise.all(handlerPromises)
		this.handlers = results.filter((handler): handler is HandlerConfig => handler !== null)

		await this.adjustActiveHandler()
	}

	/**
	 * Adjusts which handler is currently the active handler by selecting the first one under limits.
	 */
	async adjustActiveHandler(): Promise<void> {
		if (this.handlers.length === 0) {
			this.activeHandler = undefined
			this.activeProfileId = undefined
			return
		}

		// Check handlers in order, selecting the first one under limits
		for (const { handler, profileId, config } of this.handlers) {
			if (this.underLimit(config)) {
				if (this.activeHandler !== handler || this.activeProfileId !== profileId) {
					// Notify about the handler switch
					await this.notifyHandlerSwitch(profileId)
				}
				this.activeHandler = handler
				this.activeProfileId = profileId
				return
			}
		}

		// If all handlers are over limits, use the first one as fallback
		const firstHandler = this.handlers[0]
		this.activeHandler = firstHandler.handler
		this.activeProfileId = firstHandler.profileId
	}

	private async notifyHandlerSwitch(newProfileId: string | undefined): Promise<void> {
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
		vscode.window.showInformationMessage(message)
	}

	/**
	 * Checks if a profile is under its configured limits
	 */
	underLimit(profileData: VirtualQuotaFallbackProfile): boolean {
		const { profileId, profileLimits: limits } = profileData

		if (!profileId) {
			return false
		}

		if (!limits) {
			// Profile exists but has no limits set, so it can always be used
			return true
		}

		// Check limits for each time window
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
