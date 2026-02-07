/**
 * Custom modes loader
 * Loads custom modes from global and project-specific configuration files
 */

import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { parse } from "yaml"
import type { ModeConfig } from "../types/messages.js"
import { logs } from "../services/logs.js"

/**
 * Represents a path that was searched for custom modes
 */
export interface SearchedPath {
	type: "global" | "project"
	path: string
	found: boolean
	modesCount?: number
}

// Track searched paths for error reporting
let lastSearchedPaths: SearchedPath[] = []

/**
 * Get the paths that were searched in the last loadCustomModes call
 * @returns Array of searched path info
 */
export function getSearchedPaths(): SearchedPath[] {
	return lastSearchedPaths
}

/**
 * Get the global custom modes file path
 * @returns Path to global custom_modes.yaml
 */
function getGlobalModesPath(): string {
	// VS Code global storage path varies by platform
	const homeDir = homedir()

	// Try to construct the path to VS Code global storage
	// This matches the path used by the VS Code extension
	if (process.platform === "darwin") {
		// macOS
		return join(
			homeDir,
			"Library",
			"Application Support",
			"Code",
			"User",
			"globalStorage",
			"kilocode.kilo-code",
			"settings",
			"custom_modes.yaml",
		)
	} else if (process.platform === "win32") {
		// Windows
		return join(
			homeDir,
			"AppData",
			"Roaming",
			"Code",
			"User",
			"globalStorage",
			"kilocode.kilo-code",
			"settings",
			"custom_modes.yaml",
		)
	} else {
		// Linux
		return join(
			homeDir,
			".config",
			"Code",
			"User",
			"globalStorage",
			"kilocode.kilo-code",
			"settings",
			"custom_modes.yaml",
		)
	}
}

/**
 * Get the project custom modes file path
 * @param workspace - Workspace directory path
 * @returns Path to .kilocodemodes
 */
function getProjectModesPath(workspace: string): string {
	return join(workspace, ".kilocodemodes")
}

/**
 * Parse custom modes from YAML content
 * @param content - YAML file content
 * @param source - Source of the modes ('global' or 'project')
 * @returns Array of mode configurations
 */
function parseCustomModes(content: string, source: "global" | "project"): ModeConfig[] {
	try {
		const parsed = parse(content)

		if (!parsed || typeof parsed !== "object") {
			return []
		}

		// Handle both YAML format (customModes array) and JSON format
		const modes = parsed.customModes || []

		if (!Array.isArray(modes)) {
			return []
		}

		// Validate and normalize mode configs
		return modes
			.filter((mode: unknown) => {
				// Must have at least slug and name
				const m = mode as Record<string, unknown>
				return m && typeof m === "object" && m.slug && m.name
			})
			.map((mode: unknown) => {
				const m = mode as Record<string, unknown>
				return {
					slug: m.slug as string,
					name: m.name as string,
					roleDefinition: (m.roleDefinition as string) || (m.systemPrompt as string) || "",
					groups: (m.groups as ModeConfig["groups"]) || ["read", "edit", "browser", "command", "mcp"],
					customInstructions:
						(m.customInstructions as string) || (m.rules ? (m.rules as string[]).join("\n") : undefined),
					source: (m.source as ModeConfig["source"]) || source,
				}
			})
	} catch (_error) {
		// Silent fail - return empty array if parsing fails
		return []
	}
}

/**
 * Load custom modes from global configuration
 * @returns Object with modes array and path info
 */
async function loadGlobalCustomModes(): Promise<{ modes: ModeConfig[]; pathInfo: SearchedPath }> {
	const globalPath = getGlobalModesPath()
	const pathInfo: SearchedPath = {
		type: "global",
		path: globalPath,
		found: false,
		modesCount: 0,
	}

	if (!existsSync(globalPath)) {
		logs.debug(`Global custom modes file not found: ${globalPath}`, "CustomModes")
		return { modes: [], pathInfo }
	}

	try {
		const content = await readFile(globalPath, "utf-8")
		const modes = parseCustomModes(content, "global")
		pathInfo.found = true
		pathInfo.modesCount = modes.length
		logs.debug(`Loaded ${modes.length} global custom mode(s) from: ${globalPath}`, "CustomModes")
		return { modes, pathInfo }
	} catch (error) {
		logs.debug(`Failed to read global custom modes file: ${globalPath}`, "CustomModes", { error })
		return { modes: [], pathInfo }
	}
}

/**
 * Load custom modes from project configuration
 * @param workspace - Workspace directory path
 * @returns Object with modes array and path info
 */
async function loadProjectCustomModes(workspace: string): Promise<{ modes: ModeConfig[]; pathInfo: SearchedPath }> {
	const projectPath = getProjectModesPath(workspace)
	const pathInfo: SearchedPath = {
		type: "project",
		path: projectPath,
		found: false,
		modesCount: 0,
	}

	if (!existsSync(projectPath)) {
		logs.debug(`Project custom modes file not found: ${projectPath}`, "CustomModes")
		return { modes: [], pathInfo }
	}

	try {
		const content = await readFile(projectPath, "utf-8")
		const modes = parseCustomModes(content, "project")
		pathInfo.found = true
		pathInfo.modesCount = modes.length
		logs.debug(`Loaded ${modes.length} project custom mode(s) from: ${projectPath}`, "CustomModes")
		return { modes, pathInfo }
	} catch (error) {
		logs.debug(`Failed to read project custom modes file: ${projectPath}`, "CustomModes", { error })
		return { modes: [], pathInfo }
	}
}

/**
 * Load all custom modes (global + project)
 * Project modes override global modes with the same slug
 * @param workspace - Workspace directory path
 * @returns Array of all custom mode configurations
 */
export async function loadCustomModes(workspace: string): Promise<ModeConfig[]> {
	const [globalResult, projectResult] = await Promise.all([
		loadGlobalCustomModes(),
		loadProjectCustomModes(workspace),
	])

	// Store searched paths for error reporting
	lastSearchedPaths = [globalResult.pathInfo, projectResult.pathInfo]

	// Merge modes, with project modes taking precedence over global modes
	const modesMap = new Map<string, ModeConfig>()

	// Add global modes first
	for (const mode of globalResult.modes) {
		modesMap.set(mode.slug, mode)
	}

	// Override with project modes
	for (const mode of projectResult.modes) {
		modesMap.set(mode.slug, mode)
	}

	const totalModes = modesMap.size
	if (totalModes > 0) {
		logs.info(`Loaded ${totalModes} custom mode(s) total`, "CustomModes")
	}

	return Array.from(modesMap.values())
}
