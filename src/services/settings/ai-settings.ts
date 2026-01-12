/**
 * AI Features Configuration Settings
 *
 * Centralized configuration management for AI features:
 * - Enhanced Chat with Source Discovery
 * - Next Edit Guidance System
 * - Context-Aware Intelligent Completions
 * - Slack Integration
 *
 * kilocode_change - new file
 */

import * as vscode from "vscode"

/**
 * Chat feature settings
 */
export interface ChatSettings {
	enabled: boolean
	enableCitations: boolean
	maxContextFiles: number
	citationThreshold: number
	autoSaveContext: boolean
	maxMessageLength: number
	maxResponseLength: number
}

/**
 * Edit guidance feature settings
 */
export interface EditGuidanceSettings {
	enabled: boolean
	maxStepsPerPlan: number
	previewChanges: boolean
	confirmBeforeExecute: boolean
	autoDetectRelatedFiles: boolean
	maxRelatedFiles: number
	enableASTAnalysis: boolean
}

/**
 * Completions feature settings
 */
export interface CompletionsSettings {
	enabled: boolean
	contextWindowSize: number
	semanticThreshold: number
	debounceMs: number
	includeDependencies: boolean
	includeTests: boolean
	maxFiles: number
	minConfidenceScore: number
	enableNLToCode: boolean
}

/**
 * Slack integration settings
 */
export interface SlackSettings {
	enabled: boolean
	defaultChannel: string
	includeCodeBlocks: boolean
	autoFormat: boolean
	enableMentions: boolean
	maxMessageLength: number
	enableThreadedReplies: boolean
}

/**
 * Performance settings
 */
export interface PerformanceSettings {
	enableMetrics: boolean
	enableLogging: boolean
	logLevel: "debug" | "info" | "warn" | "error"
	maxLogHistory: number
	enablePerformanceMonitoring: boolean
}

/**
 * All AI feature settings
 */
export interface AISettings {
	chat: ChatSettings
	editGuidance: EditGuidanceSettings
	completions: CompletionsSettings
	slack: SlackSettings
	performance: PerformanceSettings
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: AISettings = {
	chat: {
		enabled: true,
		enableCitations: true,
		maxContextFiles: 100,
		citationThreshold: 0.7,
		autoSaveContext: true,
		maxMessageLength: 100000,
		maxResponseLength: 100000,
	},
	editGuidance: {
		enabled: true,
		maxStepsPerPlan: 50,
		previewChanges: true,
		confirmBeforeExecute: true,
		autoDetectRelatedFiles: true,
		maxRelatedFiles: 20,
		enableASTAnalysis: true,
	},
	completions: {
		enabled: true,
		contextWindowSize: 8000,
		semanticThreshold: 0.8,
		debounceMs: 300,
		includeDependencies: true,
		includeTests: false,
		maxFiles: 50,
		minConfidenceScore: 0.7,
		enableNLToCode: true,
	},
	slack: {
		enabled: true,
		defaultChannel: "#general",
		includeCodeBlocks: true,
		autoFormat: true,
		enableMentions: true,
		maxMessageLength: 4000,
		enableThreadedReplies: true,
	},
	performance: {
		enableMetrics: true,
		enableLogging: true,
		logLevel: "info",
		maxLogHistory: 1000,
		enablePerformanceMonitoring: true,
	},
}

/**
 * AI Settings Manager
 */
export class AISettingsManager {
	private static instance: AISettingsManager
	private settings: AISettings
	private config: vscode.WorkspaceConfiguration
	private disposables: vscode.Disposable[] = []

	private constructor() {
		this.config = vscode.workspace.getConfiguration("kiloCode")
		this.settings = this.loadSettings()
		this.setupConfigurationListeners()
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): AISettingsManager {
		if (!AISettingsManager.instance) {
			AISettingsManager.instance = new AISettingsManager()
		}
		return AISettingsManager.instance
	}

	/**
	 * Initialize settings manager
	 */
	async initialize(): Promise<void> {
		// Settings are loaded in constructor
	}

	/**
	 * Get all settings
	 */
	getSettings(): AISettings {
		return { ...this.settings }
	}

	/**
	 * Get chat settings
	 */
	getChatSettings(): ChatSettings {
		return { ...this.settings.chat }
	}

	/**
	 * Get edit guidance settings
	 */
	getEditGuidanceSettings(): EditGuidanceSettings {
		return { ...this.settings.editGuidance }
	}

	/**
	 * Get completions settings
	 */
	getCompletionsSettings(): CompletionsSettings {
		return { ...this.settings.completions }
	}

	/**
	 * Get Slack settings
	 */
	getSlackSettings(): SlackSettings {
		return { ...this.settings.slack }
	}

	/**
	 * Get performance settings
	 */
	getPerformanceSettings(): PerformanceSettings {
		return { ...this.settings.performance }
	}

	/**
	 * Update chat settings
	 */
	async updateChatSettings(settings: Partial<ChatSettings>): Promise<void> {
		this.settings.chat = { ...this.settings.chat, ...settings }
		await this.saveSettings("chat", this.settings.chat)
	}

	/**
	 * Update edit guidance settings
	 */
	async updateEditGuidanceSettings(settings: Partial<EditGuidanceSettings>): Promise<void> {
		this.settings.editGuidance = { ...this.settings.editGuidance, ...settings }
		await this.saveSettings("editGuidance", this.settings.editGuidance)
	}

	/**
	 * Update completions settings
	 */
	async updateCompletionsSettings(settings: Partial<CompletionsSettings>): Promise<void> {
		this.settings.completions = { ...this.settings.completions, ...settings }
		await this.saveSettings("completions", this.settings.completions)
	}

	/**
	 * Update Slack settings
	 */
	async updateSlackSettings(settings: Partial<SlackSettings>): Promise<void> {
		this.settings.slack = { ...this.settings.slack, ...settings }
		await this.saveSettings("slack", this.settings.slack)
	}

	/**
	 * Update performance settings
	 */
	async updatePerformanceSettings(settings: Partial<PerformanceSettings>): Promise<void> {
		this.settings.performance = { ...this.settings.performance, ...settings }
		await this.saveSettings("performance", this.settings.performance)
	}

	/**
	 * Reset all settings to defaults
	 */
	async resetToDefaults(): Promise<void> {
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
		await this.saveAllSettings()
	}

	/**
	 * Reset specific feature settings to defaults
	 */
	async resetFeatureToDefaults(feature: keyof AISettings): Promise<void> {
		this.settings[feature] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[feature]))
		await this.saveSettings(feature, this.settings[feature])
	}

	/**
	 * Export settings to JSON
	 */
	exportSettings(): string {
		return JSON.stringify(this.settings, null, 2)
	}

	/**
	 * Import settings from JSON
	 */
	async importSettings(json: string): Promise<void> {
		try {
			const imported = JSON.parse(json)
			this.settings = this.validateSettings(imported)
			await this.saveAllSettings()
		} catch (error) {
			throw new Error("Invalid settings JSON: " + (error as Error).message)
		}
	}

	/**
	 * Dispose settings manager
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Load settings from VSCode configuration
	 */
	private loadSettings(): AISettings {
		const settings: AISettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))

		// Load chat settings
		const chatConfig = this.config.get<any>("chat", {})
		if (chatConfig) {
			settings.chat = { ...settings.chat, ...chatConfig }
		}

		// Load edit guidance settings
		const editGuidanceConfig = this.config.get<any>("editGuidance", {})
		if (editGuidanceConfig) {
			settings.editGuidance = { ...settings.editGuidance, ...editGuidanceConfig }
		}

		// Load completions settings
		const completionsConfig = this.config.get<any>("completions", {})
		if (completionsConfig) {
			settings.completions = { ...settings.completions, ...completionsConfig }
		}

		// Load Slack settings
		const slackConfig = this.config.get<any>("slack", {})
		if (slackConfig) {
			settings.slack = { ...settings.slack, ...slackConfig }
		}

		// Load performance settings
		const performanceConfig = this.config.get<any>("performance", {})
		if (performanceConfig) {
			settings.performance = { ...settings.performance, ...performanceConfig }
		}

		return settings
	}

	/**
	 * Save settings to VSCode configuration
	 */
	private async saveSettings(feature: keyof AISettings, settings: any): Promise<void> {
		await this.config.update(feature, settings, vscode.ConfigurationTarget.Global)
	}

	/**
	 * Save all settings
	 */
	private async saveAllSettings(): Promise<void> {
		await this.saveSettings("chat", this.settings.chat)
		await this.saveSettings("editGuidance", this.settings.editGuidance)
		await this.saveSettings("completions", this.settings.completions)
		await this.saveSettings("slack", this.settings.slack)
		await this.saveSettings("performance", this.settings.performance)
	}

	/**
	 * Validate settings structure
	 */
	private validateSettings(settings: any): AISettings {
		const validated: AISettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))

		if (settings.chat) {
			validated.chat = { ...validated.chat, ...settings.chat }
		}

		if (settings.editGuidance) {
			validated.editGuidance = { ...validated.editGuidance, ...settings.editGuidance }
		}

		if (settings.completions) {
			validated.completions = { ...validated.completions, ...settings.completions }
		}

		if (settings.slack) {
			validated.slack = { ...validated.slack, ...settings.slack }
		}

		if (settings.performance) {
			validated.performance = { ...validated.performance, ...settings.performance }
		}

		return validated
	}

	/**
	 * Setup configuration change listeners
	 */
	private setupConfigurationListeners(): void {
		const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("kiloCode")) {
				this.settings = this.loadSettings()
			}
		})

		this.disposables.push(disposable)
	}
}

/**
 * Get settings manager instance
 */
export function getAISettingsManager(): AISettingsManager {
	return AISettingsManager.getInstance()
}

/**
 * Get current settings
 */
export function getAISettings(): AISettings {
	return getAISettingsManager().getSettings()
}

/**
 * Get chat settings
 */
export function getChatSettings(): ChatSettings {
	return getAISettingsManager().getChatSettings()
}

/**
 * Get edit guidance settings
 */
export function getEditGuidanceSettings(): EditGuidanceSettings {
	return getAISettingsManager().getEditGuidanceSettings()
}

/**
 * Get completions settings
 */
export function getCompletionsSettings(): CompletionsSettings {
	return getAISettingsManager().getCompletionsSettings()
}

/**
 * Get Slack settings
 */
export function getSlackSettings(): SlackSettings {
	return getAISettingsManager().getSlackSettings()
}

/**
 * Get performance settings
 */
export function getPerformanceSettings(): PerformanceSettings {
	return getAISettingsManager().getPerformanceSettings()
}
