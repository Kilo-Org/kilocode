/**
 * MCP Configuration Management
 * Handles loading/saving MCP settings from global and project-level configurations
 */

import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"

// Type definitions for MCP settings
export interface MCPServerConfig {
	command?: string // Executable for STDIO transport
	args?: string[] // Command arguments
	env?: Record<string, string> // Environment variables
	type?: "stdio" | "streamable-http" | "sse" // Transport type
	url?: string // Server URL for HTTP transports
	headers?: Record<string, string> // HTTP headers
	alwaysAllow?: string[] // Tools to auto-approve
	disabled?: boolean // Disable without removing
	timeout?: number // Request timeout in seconds (default: 60)
}

export interface MCPSettings {
	mcpServers: Record<string, MCPServerConfig>
}

// Default settings with empty servers
const defaultMCPSettings: MCPSettings = {
	mcpServers: {},
}

// Global settings path
const GLOBAL_SETTINGS_DIR = path.join(homedir(), ".kilocode", "cli", "global", "settings")
const GLOBAL_MCP_SETTINGS_FILE = path.join(GLOBAL_SETTINGS_DIR, "mcp_settings.json")

// Allow overriding paths for testing
let globalMcpSettingsDir = GLOBAL_SETTINGS_DIR
let globalMcpSettingsFile = GLOBAL_MCP_SETTINGS_FILE

/**
 * Set custom paths for testing
 */
export function setMCPSettingsPaths(dir: string, file: string): void {
	globalMcpSettingsDir = dir
	globalMcpSettingsFile = file
}

/**
 * Reset paths to defaults
 */
export function resetMCPSettingsPaths(): void {
	globalMcpSettingsDir = GLOBAL_SETTINGS_DIR
	globalMcpSettingsFile = GLOBAL_MCP_SETTINGS_FILE
}

/**
 * Get the global MCP settings path
 */
export function getMCPSettingsPath(): string {
	return globalMcpSettingsFile
}

/**
 * Get the project-level MCP settings path for a given directory
 */
export function getProjectMCPSettingsPath(cwd: string): string {
	return path.join(cwd, ".kilocode", "mcp.json")
}

/**
 * Ensure the global settings directory exists
 */
export async function ensureMCPSettingsDir(): Promise<void> {
	try {
		await fs.mkdir(globalMcpSettingsDir, { recursive: true })
	} catch (error) {
		throw new Error(
			`Failed to create MCP settings directory: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Check if global MCP settings file exists
 */
export async function mcpSettingsExists(): Promise<boolean> {
	try {
		await fs.access(globalMcpSettingsFile)
		return true
	} catch {
		return false
	}
}

/**
 * Check if project-level MCP settings file exists
 */
export async function projectMCPSettingsExists(cwd: string): Promise<boolean> {
	const projectPath = getProjectMCPSettingsPath(cwd)
	try {
		await fs.access(projectPath)
		return true
	} catch {
		return false
	}
}

/**
 * Load global MCP settings
 */
export async function loadMCPSettings(): Promise<MCPSettings> {
	try {
		await ensureMCPSettingsDir()

		if (!(await mcpSettingsExists())) {
			return defaultMCPSettings
		}

		const content = await fs.readFile(globalMcpSettingsFile, "utf-8")
		const loadedSettings = JSON.parse(content)

		// Merge with defaults to ensure all keys exist
		return {
			mcpServers: { ...defaultMCPSettings.mcpServers, ...loadedSettings.mcpServers },
		}
	} catch (error) {
		throw new Error(`Failed to load MCP settings: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Save MCP settings to the global config file
 */
export async function saveMCPSettings(settings: MCPSettings): Promise<void> {
	try {
		await ensureMCPSettingsDir()

		await fs.writeFile(globalMcpSettingsFile, JSON.stringify(settings, null, 2))
	} catch (error) {
		throw new Error(`Failed to save MCP settings: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Load project-level MCP settings
 */
export async function loadProjectMCPSettings(cwd: string): Promise<MCPSettings | null> {
	const projectPath = getProjectMCPSettingsPath(cwd)

	try {
		if (!(await projectMCPSettingsExists(cwd))) {
			return null
		}

		const content = await fs.readFile(projectPath, "utf-8")
		const loadedSettings = JSON.parse(content)

		return {
			mcpServers: loadedSettings.mcpServers || {},
		}
	} catch (error) {
		throw new Error(
			`Failed to load project MCP settings: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Save project-level MCP settings
 */
export async function saveProjectMCPSettings(cwd: string, settings: MCPSettings): Promise<void> {
	const projectPath = getProjectMCPSettingsPath(cwd)
	const projectDir = path.dirname(projectPath)

	try {
		await fs.mkdir(projectDir, { recursive: true })
		await fs.writeFile(projectPath, JSON.stringify(settings, null, 2))
	} catch (error) {
		throw new Error(
			`Failed to save project MCP settings: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Deep merge two MCPSettings objects
 * Project settings take precedence over global settings
 */
export function mergeMCPSettings(globalSettings: MCPSettings, projectSettings: MCPSettings | null): MCPSettings {
	if (!projectSettings) {
		return globalSettings
	}

	const merged: MCPSettings = {
		mcpServers: { ...globalSettings.mcpServers },
	}

	// Project settings override global settings with same name
	for (const [serverName, serverConfig] of Object.entries(projectSettings.mcpServers)) {
		if (serverConfig === null) {
			// If explicitly set to null, remove from merged
			delete merged.mcpServers[serverName]
		} else {
			// Merge server config, with project values taking precedence
			const globalServer = globalSettings.mcpServers[serverName]
			if (globalServer && typeof globalServer === "object" && typeof serverConfig === "object") {
				merged.mcpServers[serverName] = { ...globalServer, ...serverConfig }
			} else {
				merged.mcpServers[serverName] = serverConfig
			}
		}
	}

	return merged
}

/**
 * Get merged MCP settings (global + project-level override)
 */
export async function getMergedMCPSettings(cwd: string): Promise<MCPSettings> {
	const globalSettings = await loadMCPSettings()
	const projectSettings = await loadProjectMCPSettings(cwd)
	return mergeMCPSettings(globalSettings, projectSettings)
}

/**
 * Get effective settings path based on --global or --project flag
 */
export function getEffectiveSettingsPath(cwd: string, useGlobal: boolean = true): string {
	if (useGlobal) {
		return getMCPSettingsPath()
	}
	return getProjectMCPSettingsPath(cwd)
}
