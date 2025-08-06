// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import { z } from "zod"
import * as vscode from "vscode"
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
export class VirtualQuotaFallbackHandler implements ApiHandler {
	private settingsManager: ProviderSettingsManager
	private settings: ProviderSettings

	private handlerConfigs: HandlerConfig[] = []
	private activeHandler: ApiHandler | undefined
	private activeProfileId: string | undefined
	private usage: UsageTracker
	private isInitialized: boolean = false

	constructor(options: ProviderSettings) {
		this.settings = options
		this.settingsManager = new ProviderSettingsManager(ContextProxy.instance.rawContext)
		this.usage = UsageTracker.getInstance()
		this.initialize()
	}

	async initialize(): Promise<void> {
		if (!this.isInitialized) {
			await this.loadConfiguredProfiles()
			this.isInitialized = true
		}
	}

	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		await pWaitFor(() => this.isInitialized)
		await this.adjustActiveHandler()
		return this.activeHandler?.countTokens(content) ?? 0
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await pWaitFor(() => this.isInitialized)
		await this.adjustActiveHandler()

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
			await this.usage.setCooldown(this.activeProfileId, 10 * 60 * 1000)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		if (!this.activeHandler) {
			throw new Error("No active handler configured - ensure initialize() was called and profiles are available")
		}
		return this.activeHandler.getModel()
	}

	private async loadConfiguredProfiles(): Promise<void> {
		this.handlerConfigs = []

		const profiles = this.settings.profiles || []
		const handlerPromises = profiles.map(async (profile, index) => {
			if (!profile?.profileId || !profile?.profileName) {
				return null
			}

			try {
				const profileSettings = await this.settingsManager.getProfile({ id: profile.profileId })
				const apiHandler = buildApiHandler(profileSettings)

				if (apiHandler) {
					if (apiHandler instanceof OpenRouterHandler) {
						await apiHandler.fetchModel()
					}
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
		this.handlerConfigs = results.filter((handler): handler is HandlerConfig => handler !== null)

		await this.adjustActiveHandler()
	}

	async adjustActiveHandler(): Promise<void> {
		if (this.handlerConfigs.length === 0) {
			this.activeHandler = undefined
			this.activeProfileId = undefined
			return
		}

		for (const { handler, profileId, config } of this.handlerConfigs) {
			const isUnderCooldown = await this.usage.isUnderCooldown(profileId)
			if (isUnderCooldown) {
				continue
			}

			const isUnderLimit = this.underLimit(config)
			if (!isUnderLimit) {
				continue
			}

			if (this.activeHandler !== handler || this.activeProfileId !== profileId) {
				await this.notifyHandlerSwitch(profileId)
			}
			this.activeHandler = handler
			this.activeProfileId = profileId
			return
		}

		if (this.activeProfileId) {
			await this.notifyHandlerSwitch(undefined)
		}
		this.activeHandler = undefined
		this.activeProfileId = undefined
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
