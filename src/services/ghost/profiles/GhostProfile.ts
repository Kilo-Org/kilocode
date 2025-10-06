import { ApiHandler } from "../../../api"
import { PromptStrategy } from "../types/PromptStrategy"

/**
 * Configuration for creating an GhostProfile
 */
export interface GhostProfileConfig {
	id: string
	name: string
	description: string
	apiProfileId: string
	promptStrategyType: string
	isDefault?: boolean
	customSettings?: Record<string, unknown>
}

/**
 * GhostProfile pairs an API profile (provider + model) with a prompt strategy
 * (prompt generation + response parsing). This creates a complete ghost suggestion configuration
 * that users can select and customize.
 */
export class GhostProfile {
	public readonly id: string
	public readonly name: string
	public readonly description: string
	public readonly apiProfileId: string
	public readonly promptStrategyType: string
	public readonly isDefault: boolean
	public readonly customSettings: Record<string, unknown>

	private apiHandler: ApiHandler | null = null
	private promptStrategy: PromptStrategy | null = null

	constructor(config: GhostProfileConfig) {
		this.id = config.id
		this.name = config.name
		this.description = config.description
		this.apiProfileId = config.apiProfileId
		this.promptStrategyType = config.promptStrategyType
		this.isDefault = config.isDefault ?? false
		this.customSettings = config.customSettings ?? {}
	}

	/**
	 * Initialize the profile with API handler and prompt strategy instances
	 */
	public initialize(apiHandler: ApiHandler, promptStrategy: PromptStrategy): void {
		this.apiHandler = apiHandler
		this.promptStrategy = promptStrategy
	}

	/**
	 * Get the API handler for this profile
	 */
	public getApiHandler(): ApiHandler {
		if (!this.apiHandler) {
			throw new Error(`GhostProfile ${this.id} is not initialized. Call initialize() first.`)
		}
		return this.apiHandler
	}

	/**
	 * Get the prompt strategy for this profile
	 */
	public getPromptStrategy(): PromptStrategy {
		if (!this.promptStrategy) {
			throw new Error(`GhostProfile ${this.id} is not initialized. Call initialize() first.`)
		}
		return this.promptStrategy
	}

	/**
	 * Check if the profile is fully initialized
	 */
	public isInitialized(): boolean {
		return this.apiHandler !== null && this.promptStrategy !== null
	}

	/**
	 * Get profile summary for UI display
	 */
	public getSummary(): {
		id: string
		name: string
		description: string
		modelName?: string
		strategyName?: string
		isDefault: boolean
	} {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			modelName: this.apiHandler?.getModel?.()?.id,
			strategyName: this.promptStrategy?.name,
			isDefault: this.isDefault,
		}
	}

	/**
	 * Get custom setting value
	 */
	public getCustomSetting<T>(key: string, defaultValue: T): T
	public getCustomSetting<T>(key: string, defaultValue?: T): T | undefined
	public getCustomSetting<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.customSettings[key]
		return value !== undefined ? (value as T) : defaultValue
	}

	/**
	 * Update custom settings (creates new profile instance)
	 */
	public withCustomSettings(settings: Record<string, unknown>): GhostProfile {
		const config: GhostProfileConfig = {
			id: this.id,
			name: this.name,
			description: this.description,
			apiProfileId: this.apiProfileId,
			promptStrategyType: this.promptStrategyType,
			isDefault: this.isDefault,
			customSettings: { ...this.customSettings, ...settings },
		}

		const newProfile = new GhostProfile(config)
		if (this.isInitialized()) {
			newProfile.initialize(this.apiHandler!, this.promptStrategy!)
		}
		return newProfile
	}

	/**
	 * Create configuration object for persistence
	 */
	public toConfig(): GhostProfileConfig {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			apiProfileId: this.apiProfileId,
			promptStrategyType: this.promptStrategyType,
			isDefault: this.isDefault,
			customSettings: this.customSettings,
		}
	}

	/**
	 * Create GhostProfile from configuration
	 */
	public static fromConfig(config: GhostProfileConfig): GhostProfile {
		return new GhostProfile(config)
	}
}
