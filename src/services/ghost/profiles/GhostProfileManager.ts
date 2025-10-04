import { buildApiHandler } from "../../../api"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { GhostProfile, GhostProfileConfig } from "./GhostProfile"
import { PromptStrategy } from "../types/PromptStrategy"
import { MercuryStrategy } from "../strategies/MercuryStrategy"
import { LegacyXmlStrategy } from "../strategies/LegacyXmlStrategy"
import { HoleFillStrategy } from "../strategies/HoleFillStrategy"
import { FimStrategy } from "../strategies/FimStrategy"

/**
 * Registry for available prompt strategy types
 */
export interface PromptStrategyFactory {
	type: string
	name: string
	description: string
	createInstance(): PromptStrategy
}

/**
 * Manager for ghost profiles that pairs API profiles with prompt strategies.
 * Handles creation, loading, and management of user ghost suggestion configurations.
 */
export class GhostProfileManager {
	private profiles = new Map<string, GhostProfile>()
	private strategyFactories = new Map<string, PromptStrategyFactory>()
	private providerSettingsManager: ProviderSettingsManager

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.providerSettingsManager = providerSettingsManager
		this.registerBuiltInStrategyFactories()
	}

	/**
	 * Register built-in prompt strategy factories
	 */
	private registerBuiltInStrategyFactories(): void {
		// Register Mercury strategy factory
		this.strategyFactories.set("mercury", {
			type: "mercury",
			name: "Mercury Coder",
			description: "Mercury Coder prompting with markdown parsing",
			createInstance: () => new MercuryStrategy(),
		})

		// Register Legacy XML strategy factory
		this.strategyFactories.set("legacy-xml", {
			type: "legacy-xml",
			name: "Legacy XML",
			description: "Traditional XML-based prompting",
			createInstance: () => new LegacyXmlStrategy(),
		})

		// Register Hole Filler strategy factory
		this.strategyFactories.set("hole-filler", {
			type: "hole-filler",
			name: "Hole Filler",
			description: "Chat model completion using hole-filler prompting with XML parsing",
			createInstance: () => new HoleFillStrategy(),
		})

		// Register FIM strategy factory
		this.strategyFactories.set("fim", {
			type: "fim",
			name: "Fill-in-Middle",
			description: "Code model completion using native FIM tokens for models with FIM support",
			createInstance: () => new FimStrategy(),
		})
	}

	/**
	 * Register a new prompt strategy factory
	 */
	public registerStrategyFactory(factory: PromptStrategyFactory): void {
		this.strategyFactories.set(factory.type, factory)
	}

	/**
	 * Get available strategy types
	 */
	public getAvailableStrategyTypes(): PromptStrategyFactory[] {
		return Array.from(this.strategyFactories.values())
	}

	/**
	 * Create and register a new Ghost profile
	 */
	public async createProfile(config: GhostProfileConfig): Promise<GhostProfile> {
		// Validate strategy type exists
		const strategyFactory = this.strategyFactories.get(config.promptStrategyType)
		if (!strategyFactory) {
			throw new Error(`Unknown prompt strategy type: ${config.promptStrategyType}`)
		}

		// Get API profile
		const apiProfile = await this.providerSettingsManager.getProfile({ id: config.apiProfileId })
		if (!apiProfile) {
			throw new Error(`API profile not found: ${config.apiProfileId}`)
		}

		// Create Ghost profile
		const profile = new GhostProfile(config)

		// Build API handler with custom settings applied
		const apiHandlerConfig = {
			...apiProfile,
			...config.customSettings, // Apply custom model overrides
		}
		const apiHandler = buildApiHandler(apiHandlerConfig)

		// Create prompt strategy instance
		const promptStrategy = strategyFactory.createInstance()

		// Initialize profile
		profile.initialize(apiHandler, promptStrategy)

		// Store profile
		this.profiles.set(config.id, profile)

		return profile
	}

	/**
	 * Get profile by ID
	 */
	public getProfile(id: string): GhostProfile | undefined {
		return this.profiles.get(id)
	}

	/**
	 * Get all available profiles
	 */
	public getAllProfiles(): GhostProfile[] {
		return Array.from(this.profiles.values())
	}

	/**
	 * Get default profile (or first available profile)
	 */
	public getDefaultProfile(): GhostProfile | undefined {
		// Find explicitly marked default profile
		for (const profile of this.profiles.values()) {
			if (profile.isDefault) {
				return profile
			}
		}

		// Return first profile if no default is set
		const profiles = Array.from(this.profiles.values())
		return profiles.length > 0 ? profiles[0] : undefined
	}

	/**
	 * Update profile settings
	 */
	public async updateProfile(id: string, updates: Partial<GhostProfileConfig>): Promise<GhostProfile> {
		const existingProfile = this.profiles.get(id)
		if (!existingProfile) {
			throw new Error(`Profile not found: ${id}`)
		}

		// Create updated configuration
		const updatedConfig: GhostProfileConfig = {
			...existingProfile.toConfig(),
			...updates,
			id, // Ensure ID doesn't change
		}

		// Remove old profile
		this.profiles.delete(id)

		// Create new profile with updated config
		return await this.createProfile(updatedConfig)
	}

	/**
	 * Delete profile
	 */
	public deleteProfile(id: string): boolean {
		return this.profiles.delete(id)
	}

	/**
	 * Load profiles from configuration
	 */
	public async loadProfilesFromConfig(configs: GhostProfileConfig[]): Promise<void> {
		this.profiles.clear()

		for (const config of configs) {
			try {
				await this.createProfile(config)
			} catch (error) {
				console.error(`Failed to load Ghost profile ${config.id}:`, error)
			}
		}
	}

	/**
	 * Export profiles to configuration format
	 */
	public exportProfilesToConfig(): GhostProfileConfig[] {
		return Array.from(this.profiles.values()).map((profile) => profile.toConfig())
	}

	/**
	 * Create default profiles for initial setup.
	 * Provides users with 4 strategic template+model combinations covering different completion approaches.
	 */
	public async createDefaultProfiles(): Promise<GhostProfile[]> {
		const apiProfiles = await this.providerSettingsManager.listConfig()
		const defaultProfiles: GhostProfileConfig[] = []

		// Find OpenRouter profile (preferred for all profiles due to model variety)
		const openRouterProfile = apiProfiles.find((p) => p.apiProvider === "openrouter")
		// Find fallback profiles for legacy XML if OpenRouter not available
		const kilocodeProfile = apiProfiles.find((p) => p.apiProvider === "kilocode")
		const mistralProfile = apiProfiles.find((p) => p.apiProvider === "mistral")

		// Profile 1: Mercury Coder - Specialized model with Mercury prompting
		if (openRouterProfile) {
			defaultProfiles.push({
				id: "mercury-coder",
				name: "Mercury Coder",
				description: "Specialized Mercury Coder model with optimized diff-based prompting",
				apiProfileId: openRouterProfile.id,
				promptStrategyType: "mercury",
				isDefault: true,
				customSettings: {
					openRouterModelId: "inception/mercury-coder",
				},
			})
		}

		// Profile 2: Hole Filler - Chat models without native FIM support
		if (openRouterProfile) {
			defaultProfiles.push({
				id: "hole-filler",
				name: "Chat Model Completion",
				description: "GPT-4o mini with hole-filler prompting for chat models",
				apiProfileId: openRouterProfile.id,
				promptStrategyType: "hole-filler",
				isDefault: false,
				customSettings: {
					openRouterModelId: "openai/gpt-4o-mini",
				},
			})
		}

		// Profile 3: FIM Coder - Code models with native FIM support
		if (openRouterProfile) {
			defaultProfiles.push({
				id: "fim-coder",
				name: "Code Model FIM",
				description: "Qwen 2.5-7B-Instruct with native fill-in-middle tokens (fast, non-thinking)",
				apiProfileId: openRouterProfile.id,
				promptStrategyType: "fim",
				isDefault: false,
				customSettings: {
					openRouterModelId: "qwen/qwen-2.5-7b-instruct",
				},
			})
		}

		// Profile 4: Legacy XML - Fallback option with XML prompting using smarter model
		const legacyApiProfile = openRouterProfile || kilocodeProfile || mistralProfile || apiProfiles[0]
		if (legacyApiProfile) {
			const customSettings = openRouterProfile ? { openRouterModelId: "anthropic/claude-3.5-sonnet" } : {}

			defaultProfiles.push({
				id: "legacy-xml",
				name: "Legacy XML Format",
				description: "Traditional XML-based prompting with Claude 3.5 Sonnet for precise instruction following",
				apiProfileId: legacyApiProfile.id,
				promptStrategyType: "legacy-xml",
				isDefault: !openRouterProfile, // Only default if OpenRouter not available
				customSettings,
			})
		}

		// Create and return profiles
		const createdProfiles: GhostProfile[] = []
		for (const config of defaultProfiles) {
			try {
				const profile = await this.createProfile(config)
				createdProfiles.push(profile)
			} catch (error) {
				console.error(`Failed to create default profile ${config.id}:`, error)
			}
		}

		return createdProfiles
	}

	/**
	 * Get summary of all profiles for UI display
	 */
	public getProfileSummaries(): Array<{
		id: string
		name: string
		description: string
		modelName?: string
		strategyName?: string
		isDefault: boolean
		isInitialized: boolean
	}> {
		return Array.from(this.profiles.values()).map((profile) => ({
			...profile.getSummary(),
			isInitialized: profile.isInitialized(),
		}))
	}
}
