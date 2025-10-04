import { GhostProfileManager } from "./GhostProfileManager"
import { MercuryStrategy } from "../strategies/MercuryStrategy"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { GhostServiceSettings } from "@roo-code/types"

/**
 * Simple setup helper for Mercury Coder ghost suggestion profile.
 * This is the main integration point to automatically set up Mercury Coder
 * when users don't have custom provider settings enabled.
 */
export class MercuryGhostSetup {
	private profileManager: GhostProfileManager

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.profileManager = new GhostProfileManager(providerSettingsManager)
	}

	/**
	 * Set up Mercury Coder ghost suggestion profile automatically
	 * This is called when enableCustomProvider is false
	 */
	async setupDefaultMercuryProfile(settings: GhostServiceSettings) {
		try {
			console.log("Setting up default Mercury Coder ghost suggestion profile...")

			// Check if we already have profiles set up
			const existingProfiles = this.profileManager.getAllProfiles()
			if (existingProfiles.length > 0) {
				console.log("Ghost suggestion profiles already exist, using existing setup")
				return this.profileManager.getDefaultProfile()
			}

			// Create default profiles (includes Mercury if available)
			const createdProfiles = await this.profileManager.createDefaultProfiles()

			if (createdProfiles.length === 0) {
				console.warn("No ghost suggestion profiles could be created")
				return null
			}

			// Return the default profile (should be Mercury if available)
			const defaultProfile = this.profileManager.getDefaultProfile()
			if (defaultProfile) {
				console.log(`Using default ghost suggestion profile: ${defaultProfile.name}`)
			}

			return defaultProfile
		} catch (error) {
			console.error("Failed to set up Mercury Coder ghost suggestion profile:", error)
			return null
		}
	}

	/**
	 * Get the profile manager for further operations
	 */
	getProfileManager(): GhostProfileManager {
		return this.profileManager
	}

	/**
	 * Check if Mercury Coder profile is available and ready
	 */
	isMercuryProfileReady(): boolean {
		const profiles = this.profileManager.getAllProfiles()
		return profiles.some(
			(profile) => profile.getPromptStrategy() instanceof MercuryStrategy && profile.isInitialized(),
		)
	}

	/**
	 * Get Mercury Coder profile specifically
	 */
	getMercuryProfile() {
		const profiles = this.profileManager.getAllProfiles()
		return profiles.find((profile) => profile.getPromptStrategy() instanceof MercuryStrategy)
	}
}
