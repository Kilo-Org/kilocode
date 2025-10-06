import { GhostServiceSettings } from "@roo-code/types"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { GhostProfile } from "../profiles/GhostProfile"
import { MercuryGhostSetup } from "../profiles/MercuryGhostSetup"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"

/**
 * Mock Ghost Model that allows injecting mock LLM responses for testing.
 * Follows the exact same interface as GhostModel but overrides generateResponse()
 * to use pre-configured mock responses instead of making real API calls.
 */
export class MockGhostModel {
	private currentProfile: GhostProfile | null = null
	private mercurySetup: MercuryGhostSetup
	public loaded = false
	private mockResponses: Map<string, string> = new Map()
	private defaultMockResponse = ""

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.mercurySetup = new MercuryGhostSetup(providerSettingsManager)
	}

	/**
	 * Set a mock response for testing
	 */
	public setMockResponse(response: string): void {
		this.defaultMockResponse = response
	}

	/**
	 * Set a mock response for a specific prompt (advanced testing)
	 */
	public setMockResponseForPrompt(userPrompt: string, response: string): void {
		this.mockResponses.set(userPrompt, response)
	}

	/**
	 * Clear all mock responses
	 */
	public clearMockResponses(): void {
		this.mockResponses.clear()
		this.defaultMockResponse = ""
	}

	// === REAL IMPLEMENTATION METHODS (unchanged) ===

	public getCurrentProfile(): GhostProfile | null {
		return this.currentProfile
	}

	public getProfileManager() {
		return this.mercurySetup.getProfileManager()
	}

	public hasValidProfile(): boolean {
		return this.currentProfile !== null && this.currentProfile.isInitialized()
	}

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

	// === MOCK IMPLEMENTATION OF generateResponse() ===

	/**
	 * Mock implementation that uses pre-configured responses instead of making API calls
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

		// Get the mock response for this prompt
		const mockResponse = this.mockResponses.get(userPrompt) || this.defaultMockResponse

		if (!mockResponse) {
			throw new Error("No mock response configured. Call setMockResponse() before testing.")
		}

		// Simulate streaming by calling onChunk with text chunks
		// Split response into chunks to simulate realistic streaming behavior
		const chunks = this.splitIntoChunks(mockResponse, 50) // 50 chars per chunk

		for (const chunk of chunks) {
			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 1))

			onChunk({
				type: "text",
				text: chunk,
			} as ApiStreamChunk)
		}

		// Send usage info at the end (like real API)
		onChunk({
			type: "usage",
			totalCost: 0.001, // Mock cost
			inputTokens: Math.floor(userPrompt.length / 4), // Rough estimate
			outputTokens: Math.floor(mockResponse.length / 4), // Rough estimate
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		} as ApiStreamChunk)

		return {
			cost: 0.001,
			inputTokens: Math.floor(userPrompt.length / 4),
			outputTokens: Math.floor(mockResponse.length / 4),
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}
	}

	/**
	 * Split text into chunks for simulating streaming
	 */
	private splitIntoChunks(text: string, chunkSize: number): string[] {
		const chunks: string[] = []
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.substring(i, i + chunkSize))
		}
		return chunks
	}

	// === REAL IMPLEMENTATION METHODS (unchanged) ===

	public getModelName(): string | null {
		if (!this.currentProfile?.isInitialized()) {
			return null
		}
		// Extract model name from API handler
		return this.currentProfile.getApiHandler().getModel().id ?? "mock-model"
	}

	public hasValidCredentials(): boolean {
		return this.hasValidProfile()
	}

	/**
	 * Mock implementation of generateCompleteResponse
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
		})

		return {
			content: completeContent,
			...result,
		}
	}
}
