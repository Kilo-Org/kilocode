import { GhostServiceSettings } from "@roo-code/types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ApiStreamChunk } from "../../api/transform/stream"
import { GhostProfile } from "./profiles/GhostProfile"
import { MercuryGhostSetup } from "./profiles/MercuryGhostSetup"

export class GhostModel {
	private currentProfile: GhostProfile | null = null
	private mercurySetup: MercuryGhostSetup
	public loaded = false

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.mercurySetup = new MercuryGhostSetup(providerSettingsManager)
	}

	/**
	 * Get the current Ghost profile
	 */
	public getCurrentProfile(): GhostProfile | null {
		return this.currentProfile
	}

	/**
	 * Get the profile manager
	 */
	public getProfileManager() {
		return this.mercurySetup.getProfileManager()
	}

	/**
	 * Check if a valid profile is loaded
	 */
	public hasValidProfile(): boolean {
		return this.currentProfile !== null && this.currentProfile.isInitialized()
	}

	/**
	 * Load Ghost configuration
	 * This is the main integration point - automatically sets up Mercury Coder
	 * when enableCustomProvider is false
	 */
	public async reload(settings: GhostServiceSettings): Promise<void> {
		try {
			let selectedProfile: GhostProfile | null = null

			// Check if user has custom provider enabled
			const enableCustomProvider = settings?.enableCustomProvider || false

			if (!enableCustomProvider) {
				// Automatically set up Mercury Coder profile
				console.log("enableCustomProvider is false - setting up Mercury Coder Ghost profile")
				selectedProfile = (await this.mercurySetup.setupDefaultMercuryProfile(settings)) || null
			} else {
				// User has custom provider - try to use existing profiles or create defaults
				console.log("enableCustomProvider is true - using existing profile system")
				const profileManager = this.mercurySetup.getProfileManager()
				const existingProfiles = profileManager.getAllProfiles()

				if (existingProfiles.length === 0) {
					await profileManager.createDefaultProfiles()
				}

				selectedProfile = profileManager.getDefaultProfile() || null
			}

			// Final validation and setup
			if (selectedProfile && selectedProfile.isInitialized()) {
				this.currentProfile = selectedProfile
				this.loaded = true
				console.log(
					`Successfully loaded Ghost profile: ${selectedProfile.name} with strategy: ${selectedProfile.getPromptStrategy().name}`,
				)
			} else {
				console.error("No valid Ghost profiles available")
				this.currentProfile = null
				this.loaded = false
			}
		} catch (error) {
			console.error("Failed to load Ghost profiles:", error)
			this.currentProfile = null
			this.loaded = false
		}
	}

	/**
	 * Switch to a different Ghost profile
	 */
	public async switchProfile(profileId: string): Promise<boolean> {
		try {
			const profileManager = this.mercurySetup.getProfileManager()
			const profile = profileManager.getProfile(profileId)
			if (!profile || !profile.isInitialized()) {
				console.error(`Invalid profile: ${profileId}`)
				return false
			}

			this.currentProfile = profile
			console.log(`Switched to Ghost profile: ${profile.name}`)
			return true
		} catch (error) {
			console.error(`Failed to switch to profile ${profileId}:`, error)
			return false
		}
	}

	/**
	 * Generate response with streaming callback support using current profile
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
		if (!this.currentProfile || !this.currentProfile.isInitialized()) {
			throw new Error("No Ghost profile loaded. Please check your configuration.")
		}

		const handler = this.currentProfile.getApiHandler()

		const stream = handler.createMessage(systemPrompt, [
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
		if (!this.currentProfile?.isInitialized()) {
			return null
		}
		// Extract model name from API handler
		return this.currentProfile.getApiHandler().getModel().id ?? "unknown"
	}

	public hasValidCredentials(): boolean {
		return this.hasValidProfile()
	}

	/**
	 * Generate complete response (non-streaming) using current profile
	 */
	public async generateCompleteResponse(
		systemPrompt: string,
		userPrompt: string,
	): Promise<{
		content: string
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}> {
		let completeContent = ""

		const result = await this.generateResponse(systemPrompt, userPrompt, (chunk) => {
			// Collect content chunks
			if (chunk.type === "text") {
				completeContent += chunk.text || ""
			}
			// Usage info will be captured in the parent method
		})

		return {
			content: completeContent,
			cost: result.cost,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			cacheReadTokens: result.cacheReadTokens,
			cacheWriteTokens: result.cacheWriteTokens,
		}
	}
}
