/**
 * MockWorkspaceConfiguration class for VSCode API
 */

import * as path from "path"
import { logs } from "../utils/logger.js"
import { VSCodeMockPaths, ensureDirectoryExists } from "../utils/paths.js"
import { FileMemento } from "../storage/Memento.js"
import { ConfigurationTarget } from "../types.js"
import type { ConfigurationInspect } from "../types.js"
import type { WorkspaceConfiguration } from "../interfaces/workspace.js"
import type { ExtensionContextImpl } from "../context/ExtensionContext.js"

/**
 * In-memory runtime configuration store shared across all MockWorkspaceConfiguration instances.
 * This allows configuration to be updated at runtime (e.g., from CLI settings) without
 * persisting to disk. Values in this store take precedence over disk-based mementos.
 */
const runtimeConfig: Map<string, unknown> = new Map()

/**
 * Set a runtime configuration value.
 * @param section The configuration section (e.g., "roo-cline")
 * @param key The configuration key (e.g., "commandExecutionTimeout")
 * @param value The value to set
 */
export function setRuntimeConfig(section: string, key: string, value: unknown): void {
	const fullKey = `${section}.${key}`
	runtimeConfig.set(fullKey, value)
	logs.debug(`Runtime config set: ${fullKey} = ${JSON.stringify(value)}`, "VSCode.MockWorkspaceConfiguration")
}

/**
 * Set multiple runtime configuration values at once.
 * @param section The configuration section (e.g., "roo-cline")
 * @param values Object containing key-value pairs to set
 */
export function setRuntimeConfigValues(section: string, values: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) {
			setRuntimeConfig(section, key, value)
		}
	}
}

/**
 * Clear all runtime configuration values.
 */
export function clearRuntimeConfig(): void {
	runtimeConfig.clear()
	logs.debug("Runtime config cleared", "VSCode.MockWorkspaceConfiguration")
}

/**
 * Get a runtime configuration value.
 * @param fullKey The full configuration key (e.g., "roo-cline.commandExecutionTimeout")
 * @returns The value or undefined if not set
 */
export function getRuntimeConfig(fullKey: string): unknown {
	return runtimeConfig.get(fullKey)
}

/**
 * Mock workspace configuration for CLI mode
 * Persists configuration to JSON files
 */
export class MockWorkspaceConfiguration implements WorkspaceConfiguration {
	private section: string | undefined
	private globalMemento: FileMemento
	private workspaceMemento: FileMemento

	constructor(section?: string, context?: ExtensionContextImpl) {
		this.section = section

		if (context) {
			// Use the extension context's mementos
			this.globalMemento = context.globalState as unknown as FileMemento
			this.workspaceMemento = context.workspaceState as unknown as FileMemento
		} else {
			// Fallback: create our own mementos (shouldn't happen in normal usage)
			const globalStoragePath = VSCodeMockPaths.getGlobalStorageDir()
			const workspaceStoragePath = VSCodeMockPaths.getWorkspaceStorageDir(process.cwd())

			ensureDirectoryExists(globalStoragePath)
			ensureDirectoryExists(workspaceStoragePath)

			this.globalMemento = new FileMemento(path.join(globalStoragePath, "configuration.json"))
			this.workspaceMemento = new FileMemento(path.join(workspaceStoragePath, "configuration.json"))
		}
	}

	get<T>(section: string, defaultValue?: T): T | undefined {
		const fullSection = this.section ? `${this.section}.${section}` : section

		// Check runtime configuration first (highest priority - set by CLI at runtime)
		const runtimeValue = runtimeConfig.get(fullSection)
		if (runtimeValue !== undefined) {
			return runtimeValue as T
		}

		// Check workspace configuration (persisted to disk)
		const workspaceValue = this.workspaceMemento.get(fullSection)
		if (workspaceValue !== undefined && workspaceValue !== null) {
			return workspaceValue as T
		}

		// Check global configuration (persisted to disk)
		const globalValue = this.globalMemento.get(fullSection)
		if (globalValue !== undefined && globalValue !== null) {
			return globalValue as T
		}

		// Return default value
		return defaultValue
	}

	has(section: string): boolean {
		const fullSection = this.section ? `${this.section}.${section}` : section
		return this.workspaceMemento.get(fullSection) !== undefined || this.globalMemento.get(fullSection) !== undefined
	}

	inspect<T>(section: string): ConfigurationInspect<T> | undefined {
		const fullSection = this.section ? `${this.section}.${section}` : section
		const workspaceValue = this.workspaceMemento.get(fullSection)
		const globalValue = this.globalMemento.get(fullSection)

		if (workspaceValue !== undefined || globalValue !== undefined) {
			return {
				key: fullSection,
				defaultValue: undefined,
				globalValue: globalValue as T | undefined,
				workspaceValue: workspaceValue as T | undefined,
				workspaceFolderValue: undefined,
			}
		}

		return undefined
	}

	async update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Promise<void> {
		const fullSection = this.section ? `${this.section}.${section}` : section

		try {
			// Determine which memento to use based on configuration target
			const memento =
				configurationTarget === ConfigurationTarget.Workspace ? this.workspaceMemento : this.globalMemento

			const scope = configurationTarget === ConfigurationTarget.Workspace ? "workspace" : "global"

			// Update the memento (this automatically persists to disk)
			await memento.update(fullSection, value)

			logs.debug(
				`Configuration updated: ${fullSection} = ${JSON.stringify(value)} (${scope})`,
				"VSCode.MockWorkspaceConfiguration",
			)
		} catch (error) {
			logs.error(`Failed to update configuration: ${fullSection}`, "VSCode.MockWorkspaceConfiguration", {
				error,
			})
			throw error
		}
	}

	// Additional method to reload configuration from disk
	public reload(): void {
		// FileMemento automatically loads from disk, so we don't need to do anything special
		logs.debug("Configuration reload requested", "VSCode.MockWorkspaceConfiguration")
	}

	// Method to get all configuration data (useful for debugging and generic config loading)
	public getAllConfig(): Record<string, unknown> {
		const globalKeys = this.globalMemento.keys()
		const workspaceKeys = this.workspaceMemento.keys()
		const allConfig: Record<string, unknown> = {}

		// Add global settings first
		for (const key of globalKeys) {
			const value = this.globalMemento.get(key)
			if (value !== undefined && value !== null) {
				allConfig[key] = value
			}
		}

		// Add workspace settings (these override global)
		for (const key of workspaceKeys) {
			const value = this.workspaceMemento.get(key)
			if (value !== undefined && value !== null) {
				allConfig[key] = value
			}
		}

		return allConfig
	}
}
