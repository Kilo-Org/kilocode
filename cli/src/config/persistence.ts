import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import type { CLIConfig, AutoApprovalConfig } from "./types.js"
import { DEFAULT_CONFIG, DEFAULT_AUTO_APPROVAL } from "./defaults.js"
import { validateConfig, type ValidationResult } from "./validation.js"
import { logs } from "../services/logs.js"
import { buildConfigFromEnv, isEphemeralMode } from "./env-config.js"

/**
 * Result of loading config, includes both the config and validation status
 */
export interface ConfigLoadResult {
	config: CLIConfig
	validation: ValidationResult
}

export const CONFIG_DIR = path.join(homedir(), ".kilocode", "cli")
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")

// Allow overriding paths for testing
let configDir = CONFIG_DIR
let configFile = CONFIG_FILE

export function setConfigPaths(dir: string, file: string): void {
	configDir = dir
	configFile = file
}

export function resetConfigPaths(): void {
	configDir = CONFIG_DIR
	configFile = CONFIG_FILE
}

export async function ensureConfigDir(): Promise<void> {
	try {
		await fs.mkdir(configDir, { recursive: true })
	} catch (error) {
		logs.error("Failed to create config directory", "ConfigPersistence", { error })
		throw error
	}
}

/**
 * Deep merge two objects, with source taking precedence
 * Used to fill in missing config keys with defaults
 * - Starts with all keys from target (defaults)
 * - Overwrites with values from source (user config) where they exist
 * - Recursively merges nested objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
	// Start with a copy of target to get all default keys
	const result = { ...target }

	// Iterate over source keys to override defaults
	for (const key in source) {
		const sourceValue = source[key]
		const targetValue = result[key]

		if (sourceValue !== undefined) {
			// If both are objects (not arrays), merge recursively
			if (
				typeof sourceValue === "object" &&
				sourceValue !== null &&
				!Array.isArray(sourceValue) &&
				typeof targetValue === "object" &&
				targetValue !== null &&
				!Array.isArray(targetValue)
			) {
				// Recursively merge nested objects
				result[key] = deepMerge(targetValue, sourceValue)
			} else {
				// Otherwise, source value takes precedence
				result[key] = sourceValue
			}
		}
	}

	return result
}

/**
 * Merge loaded config with defaults to fill in missing keys
 */
function mergeWithDefaults(loadedConfig: Partial<CLIConfig>): CLIConfig {
	// Merge defaults with loaded config - loaded config takes precedence
	// deepMerge(target, source) where source overrides target
	const merged = deepMerge(DEFAULT_CONFIG, loadedConfig) as CLIConfig

	// Special handling for autoApproval to ensure all nested keys have defaults
	// while preserving user values
	if (loadedConfig.autoApproval) {
		merged.autoApproval = deepMerge(DEFAULT_AUTO_APPROVAL, loadedConfig.autoApproval) as AutoApprovalConfig
	} else {
		merged.autoApproval = DEFAULT_AUTO_APPROVAL
	}

	// Special handling for providers array to merge each provider with defaults
	if (loadedConfig.providers && Array.isArray(loadedConfig.providers)) {
		merged.providers = loadedConfig.providers.map((loadedProvider) => {
			// Find matching default provider by id
			const defaultProvider = DEFAULT_CONFIG.providers.find((p) => p.provider === loadedProvider.provider)
			if (defaultProvider) {
				// Merge loaded provider with default to fill in missing fields
				return deepMerge(defaultProvider, loadedProvider)
			}
			// If no matching default, return as-is (will be validated later)
			return loadedProvider
		})
	}

	// Ensure customThemes property exists (for backward compatibility)
	if (!merged.customThemes) {
		merged.customThemes = {}
	}

	return merged
}

export async function loadConfig(): Promise<ConfigLoadResult> {
	try {
		await ensureConfigDir()

		// Check if we can build config from environment variables
		if (!(await configExists())) {
			// Try to build config from environment variables
			const envConfig = buildConfigFromEnv()

			if (envConfig) {
				logs.info("Using configuration from environment variables (ephemeral mode)", "ConfigPersistence")

				// Validate the env config
				const validation = await validateConfig(envConfig)

				// Don't write to file in ephemeral mode
				if (!isEphemeralMode()) {
					logs.debug("Writing env-based config to file", "ConfigPersistence")
					await fs.writeFile(configFile, JSON.stringify(envConfig, null, 2))
				}

				return {
					config: envConfig,
					validation,
				}
			}

			// No env config available, create default config file
			// File doesn't exist, write default config directly without validation
			// (DEFAULT_CONFIG may have empty credentials which is ok for initial setup)
			await fs.writeFile(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2))
			logs.debug("Created default config file", "ConfigPersistence")

			// Validate the default config
			const validation = await validateConfig(DEFAULT_CONFIG)
			return {
				config: DEFAULT_CONFIG,
				validation,
			}
		}

		// Read and parse config
		const content = await fs.readFile(configFile, "utf-8")
		const loadedConfig = JSON.parse(content)

		// Merge with defaults to fill in missing keys
		const config = mergeWithDefaults(loadedConfig)

		// Validate merged config
		const validation = await validateConfig(config)
		if (!validation.valid) {
			logs.error("Invalid config file", "ConfigPersistence", { errors: validation.errors })
			// Return config with validation errors instead of throwing
			return {
				config,
				validation,
			}
		}

		// Save the merged config back to ensure all defaults are persisted
		// Only save if validation passed
		await saveConfig(config)

		return {
			config: config as CLIConfig,
			validation,
		}
	} catch (error) {
		// For errors (e.g., file read errors, JSON parse errors), log and throw
		logs.error("Failed to load config", "ConfigPersistence", { error })
		throw error
	}
}

export async function saveConfig(config: CLIConfig, skipValidation: boolean = false): Promise<void> {
	try {
		await ensureConfigDir()

		// Validate before saving (unless explicitly skipped for initial config creation)
		if (!skipValidation) {
			const validation = await validateConfig(config)
			if (!validation.valid) {
				throw new Error(`Invalid config: ${validation.errors?.join(", ")}`)
			}
		}

		// Write config with pretty formatting
		await fs.writeFile(configFile, JSON.stringify(config, null, 2))
		logs.debug("Config saved successfully", "ConfigPersistence")
	} catch (error) {
		logs.error("Failed to save config", "ConfigPersistence", { error })
		throw error
	}
}

export function getConfigPath(): string {
	return configFile
}

export async function configExists(): Promise<boolean> {
	try {
		await fs.access(configFile)
		return true
	} catch {
		return false
	}
}
