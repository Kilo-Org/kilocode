// kilocode_change - new file for BMAD-METHOD configuration management

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as yaml from "yaml"

import type { BmadConfig, BmadModuleConfig } from "./types"
import { fileExistsAtPath } from "../../utils/fs"
import { getWorkspacePath } from "../../utils/path"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Default BMAD configuration
 */
export const DEFAULT_BMAD_CONFIG: BmadConfig = {
	enabled: true,
	installationPath: "_bmad",
	activeModules: ["bmm", "bmb", "cis", "bmgd"],
	defaultWorkflow: null,
	autoSyncModes: true,
	syncInterval: 300000, // 5 minutes
	knowledgeBaseEnabled: true,
	partyModeEnabled: true,
	customModulesPath: null,
	debugMode: false,
}

/**
 * BMAD configuration keys for VS Code settings
 */
export const BMAD_CONFIG_KEYS = {
	enabled: "bmad.enabled",
	installationPath: "bmad.installationPath",
	activeModules: "bmad.activeModules",
	defaultWorkflow: "bmad.defaultWorkflow",
	autoSyncModes: "bmad.autoSyncModes",
	syncInterval: "bmad.syncInterval",
	knowledgeBaseEnabled: "bmad.knowledgeBaseEnabled",
	partyModeEnabled: "bmad.partyModeEnabled",
	customModulesPath: "bmad.customModulesPath",
	debugMode: "bmad.debugMode",
} as const

/**
 * BMAD configuration manager
 */
export class BmadConfigManager {
	private config: BmadConfig
	private configFilePath: string
	private disposables: vscode.Disposable[] = []
	private watchers: vscode.FileSystemWatcher[] = []

	constructor(private readonly context: vscode.ExtensionContext) {
		this.configFilePath = this.getConfigFilePath()
		this.config = DEFAULT_BMAD_CONFIG
	}

	/**
	 * Get the configuration file path
	 */
	private getConfigFilePath(): string {
		const workspacePath = getWorkspacePath()
		if (workspacePath) {
			return path.join(workspacePath, ".bmad", "config.yaml")
		}
		return path.join(this.context.globalStorageUri.fsPath, "bmad-config.yaml")
	}

	/**
	 * Initialize the configuration manager
	 */
	async initialize(): Promise<void> {
		try {
			// Load configuration from file
			await this.loadConfigFromFile()

			// Merge with VS Code settings
			this.mergeWithVsCodeSettings()

			// Watch for configuration changes
			this.setupConfigWatchers()

			logger.info("[BmadConfigManager] Initialized successfully")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadConfigManager] Failed to initialize", { error: errorMessage })
			// Use default config if loading fails
			this.config = { ...DEFAULT_BMAD_CONFIG }
		}
	}

	/**
	 * Load configuration from file
	 */
	private async loadConfigFromFile(): Promise<void> {
		const exists = await fileExistsAtPath(this.configFilePath)
		if (!exists) {
			logger.info("[BmadConfigManager] Config file does not exist, using defaults")
			return
		}

		try {
			const content = await fs.readFile(this.configFilePath, "utf-8")
			const parsed = yaml.parse(content)

			if (parsed && typeof parsed === "object") {
				this.config = {
					...DEFAULT_BMAD_CONFIG,
					...parsed,
				}
				logger.info("[BmadConfigManager] Loaded config from file")
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadConfigManager] Failed to load config file", { error: errorMessage })
		}
	}

	/**
	 * Merge configuration with VS Code settings
	 */
	private mergeWithVsCodeSettings(): void {
		const config = vscode.workspace.getConfiguration("bmad")

		this.config = {
			...this.config,
			enabled: config.get("enabled", DEFAULT_BMAD_CONFIG.enabled),
			installationPath: config.get("installationPath", DEFAULT_BMAD_CONFIG.installationPath),
			activeModules: config.get("activeModules", DEFAULT_BMAD_CONFIG.activeModules),
			defaultWorkflow: config.get("defaultWorkflow", DEFAULT_BMAD_CONFIG.defaultWorkflow),
			autoSyncModes: config.get("autoSyncModes", DEFAULT_BMAD_CONFIG.autoSyncModes),
			syncInterval: config.get("syncInterval", DEFAULT_BMAD_CONFIG.syncInterval),
			knowledgeBaseEnabled: config.get("knowledgeBaseEnabled", DEFAULT_BMAD_CONFIG.knowledgeBaseEnabled),
			partyModeEnabled: config.get("partyModeEnabled", DEFAULT_BMAD_CONFIG.partyModeEnabled),
			customModulesPath: config.get("customModulesPath", DEFAULT_BMAD_CONFIG.customModulesPath),
			debugMode: config.get("debugMode", DEFAULT_BMAD_CONFIG.debugMode),
		}

		logger.info("[BmadConfigManager] Merged with VS Code settings")
	}

	/**
	 * Setup file watchers for configuration changes
	 */
	private setupConfigWatchers(): void {
		// Watch the config file
		const configWatcher = vscode.workspace.createFileSystemWatcher(this.configFilePath)

		configWatcher.onDidChange(() => {
			logger.info("[BmadConfigManager] Config file changed, reloading")
			this.loadConfigFromFile().catch((error) => {
				logger.error("[BmadConfigManager] Failed to reload config", { error })
			})
		})

		configWatcher.onDidCreate(() => {
			logger.info("[BmadConfigManager] Config file created, reloading")
			this.loadConfigFromFile().catch((error) => {
				logger.error("[BmadConfigManager] Failed to load new config", { error })
			})
		})

		configWatcher.onDidDelete(() => {
			logger.info("[BmadConfigManager] Config file deleted, using defaults")
			this.config = { ...DEFAULT_BMAD_CONFIG }
		})

		this.watchers.push(configWatcher)
		this.disposables.push(configWatcher)

		// Watch VS Code settings
		const settingsWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("bmad")) {
				logger.info("[BmadConfigManager] VS Code settings changed, reloading")
				this.mergeWithVsCodeSettings()
			}
		})

		this.disposables.push(settingsWatcher)
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): BmadConfig {
		return { ...this.config }
	}

	/**
	 * Update a specific configuration value
	 */
	async updateConfig<K extends keyof BmadConfig>(key: K, value: BmadConfig[K]): Promise<void> {
		this.config[key] = value

		// Update VS Code settings
		const config = vscode.workspace.getConfiguration("bmad")
		await config.update(key, value, vscode.ConfigurationTarget.Global)

		// Save to file
		await this.saveConfigToFile()

		logger.info("[BmadConfigManager] Updated config", { key, value })
	}

	/**
	 * Update multiple configuration values
	 */
	async updateConfigMultiple(updates: Partial<BmadConfig>): Promise<void> {
		this.config = { ...this.config, ...updates }

		// Update VS Code settings
		const config = vscode.workspace.getConfiguration("bmad")
		for (const [key, value] of Object.entries(updates)) {
			await config.update(key, value, vscode.ConfigurationTarget.Global)
		}

		// Save to file
		await this.saveConfigToFile()

		logger.info("[BmadConfigManager] Updated multiple config values", { updates })
	}

	/**
	 * Save configuration to file
	 */
	private async saveConfigToFile(): Promise<void> {
		try {
			const dir = path.dirname(this.configFilePath)
			await fs.mkdir(dir, { recursive: true })

			const yamlContent = yaml.stringify(this.config, { lineWidth: 0 })
			await fs.writeFile(this.configFilePath, yamlContent, "utf-8")

			logger.info("[BmadConfigManager] Saved config to file")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadConfigManager] Failed to save config file", { error: errorMessage })
			vscode.window.showErrorMessage(t("common:bmad.errors.saveConfigFailed", { error: errorMessage }))
		}
	}

	/**
	 * Reset configuration to defaults
	 */
	async resetConfig(): Promise<void> {
		this.config = { ...DEFAULT_BMAD_CONFIG }
		await this.saveConfigToFile()

		// Reset VS Code settings
		const config = vscode.workspace.getConfiguration("bmad")
		for (const key of Object.keys(DEFAULT_BMAD_CONFIG)) {
			await config.update(key, undefined, vscode.ConfigurationTarget.Global)
		}

		logger.info("[BmadConfigManager] Reset config to defaults")
	}

	/**
	 * Check if BMAD is enabled
	 */
	isEnabled(): boolean {
		return this.config.enabled
	}

	/**
	 * Get the installation path
	 */
	getInstallationPath(): string {
		const workspacePath = getWorkspacePath()
		if (workspacePath) {
			return path.join(workspacePath, this.config.installationPath)
		}
		return this.config.installationPath
	}

	/**
	 * Get active modules
	 */
	getActiveModules(): string[] {
		return [...this.config.activeModules]
	}

	/**
	 * Check if a module is active
	 */
	isModuleActive(moduleId: string): boolean {
		return this.config.activeModules.includes(moduleId)
	}

	/**
	 * Load module-specific configuration
	 */
	async loadModuleConfig(moduleId: string): Promise<BmadModuleConfig | null> {
		const installationPath = this.getInstallationPath()
		const moduleConfigPath = path.join(installationPath, moduleId, "config.yaml")

		try {
			const exists = await fileExistsAtPath(moduleConfigPath)
			if (!exists) {
				return null
			}

			const content = await fs.readFile(moduleConfigPath, "utf-8")
			const parsed = yaml.parse(content)

			if (parsed && typeof parsed === "object") {
				return parsed as BmadModuleConfig
			}

			return null
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadConfigManager] Failed to load module config", { moduleId, error: errorMessage })
			return null
		}
	}

	/**
	 * Save module-specific configuration
	 */
	async saveModuleConfig(moduleId: string, config: BmadModuleConfig): Promise<void> {
		const installationPath = this.getInstallationPath()
		const moduleConfigPath = path.join(installationPath, moduleId, "config.yaml")

		try {
			const dir = path.dirname(moduleConfigPath)
			await fs.mkdir(dir, { recursive: true })

			const yamlContent = yaml.stringify(config, { lineWidth: 0 })
			await fs.writeFile(moduleConfigPath, yamlContent, "utf-8")

			logger.info("[BmadConfigManager] Saved module config", { moduleId })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadConfigManager] Failed to save module config", { moduleId, error: errorMessage })
			throw new Error(`Failed to save module config: ${errorMessage}`)
		}
	}

	/**
	 * Validate configuration
	 */
	validateConfig(): { isValid: boolean; errors: string[] } {
		const errors: string[] = []

		// Validate installation path
		if (!this.config.installationPath || this.config.installationPath.trim() === "") {
			errors.push("Installation path cannot be empty")
		}

		// Validate active modules
		if (!Array.isArray(this.config.activeModules) || this.config.activeModules.length === 0) {
			errors.push("At least one active module is required")
		}

		// Validate sync interval
		if (this.config.syncInterval < 60000) {
			errors.push("Sync interval must be at least 60 seconds")
		}

		// Validate custom modules path if provided
		if (this.config.customModulesPath && this.config.customModulesPath.trim() === "") {
			errors.push("Custom modules path cannot be empty if provided")
		}

		return {
			isValid: errors.length === 0,
			errors,
		}
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables = []
		this.watchers = []
	}
}

/**
 * Get the BMAD configuration manager instance
 */
let configManagerInstance: BmadConfigManager | null = null

export function getBmadConfigManager(context: vscode.ExtensionContext): BmadConfigManager {
	if (!configManagerInstance) {
		configManagerInstance = new BmadConfigManager(context)
	}
	return configManagerInstance
}

export function disposeBmadConfigManager(): void {
	if (configManagerInstance) {
		configManagerInstance.dispose()
		configManagerInstance = null
	}
}
