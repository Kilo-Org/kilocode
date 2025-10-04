import { GhostProvider } from "../GhostProvider"
import { GhostSuggestionContext } from "../types"
import { MercuryStrategy } from "../strategies/MercuryStrategy"

/**
 * Integration helper to connect GhostProvider with the new Ghost Profile system
 */
export class GhostProviderProfileIntegration {
	/**
	 * Update GhostProvider to use the current Ghost profile's strategy
	 */
	static updateProviderWithCurrentProfile(provider: GhostProvider): boolean {
		try {
			// Get current profile from model
			const currentProfile = (provider as any).model.getCurrentProfile()
			if (!currentProfile || !currentProfile.isInitialized()) {
				console.warn("No Ghost profile loaded")
				return false
			}

			const strategy = currentProfile.getPromptStrategy()
			console.log(`Using Ghost profile: ${currentProfile.name} with strategy: ${strategy.name}`)

			// Set the strategy on GhostStrategy
			;(provider as any).strategy.setStrategy(strategy)

			return true
		} catch (error) {
			console.error("Failed to update provider with profile:", error)
			return false
		}
	}

	/**
	 * Handle response parsing based on the current profile's strategy
	 */
	static async parseResponseWithCurrentProfile(
		provider: GhostProvider,
		response: string,
		context: GhostSuggestionContext,
	): Promise<boolean> {
		try {
			const currentProfile = (provider as any).model.getCurrentProfile()
			if (!currentProfile || !currentProfile.isInitialized()) {
				return false
			}

			// This method is deprecated - all parsing now happens through streaming interface
			console.warn("GhostProviderProfileIntegration.parseResponseWithCurrentProfile is deprecated")
			return false
		} catch (error) {
			console.error("Failed to parse response with profile:", error)
			return false
		}
	}

	/**
	 * Check if the current profile uses Mercury Coder strategy
	 */
	static isUsingMercuryStrategy(provider: GhostProvider): boolean {
		try {
			const currentProfile = (provider as any).model.getCurrentProfile()
			if (!currentProfile || !currentProfile.isInitialized()) {
				return false
			}

			const strategy = currentProfile.getPromptStrategy()
			return strategy instanceof MercuryStrategy
		} catch (error) {
			return false
		}
	}
}
