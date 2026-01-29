/**
 * Hooks configuration loader
 * Loads and merges hooks from global (~/.kilocode/cli/config.json)
 * and project (<workspace>/.kilocode/cli/config.json) configurations
 */

import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import { existsSync } from "fs"
import type { HooksConfig, HookMatcher, HookEvent } from "../config/types.js"
import { logs } from "../services/logs.js"

/**
 * Global config directory path
 */
export const GLOBAL_CONFIG_DIR = path.join(homedir(), ".kilocode", "cli")
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json")

/**
 * Get project config file path
 */
export function getProjectConfigPath(workspace: string): string {
	return path.join(workspace, ".kilocode", "cli", "config.json")
}

/**
 * Load hooks from a config file
 * Returns empty object if file doesn't exist or has no hooks
 */
async function loadHooksFromFile(configPath: string): Promise<HooksConfig> {
	if (!existsSync(configPath)) {
		logs.debug(`Hooks config file not found: ${configPath}`, "HooksConfig")
		return {}
	}

	try {
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		if (!config.hooks || typeof config.hooks !== "object") {
			return {}
		}

		// Validate and normalize hooks structure
		return normalizeHooksConfig(config.hooks)
	} catch (error) {
		logs.warn(`Failed to load hooks from ${configPath}`, "HooksConfig", { error })
		return {}
	}
}

/**
 * Normalize and validate hooks configuration
 * Ensures all hook entries have the correct structure
 */
function normalizeHooksConfig(hooks: unknown): HooksConfig {
	if (!hooks || typeof hooks !== "object") {
		return {}
	}

	const validEvents: HookEvent[] = [
		"PreToolUse",
		"PostToolUse",
		"PermissionRequest",
		"Notification",
		"UserPromptSubmit",
		"Stop",
		"PreCompact",
		"SessionStart",
		"SessionEnd",
	]

	const normalized: HooksConfig = {}
	const hooksObj = hooks as Record<string, unknown>

	for (const event of validEvents) {
		const eventHooks = hooksObj[event]
		if (!Array.isArray(eventHooks)) {
			continue
		}

		const validMatchers: HookMatcher[] = []
		for (const matcher of eventHooks) {
			const normalizedMatcher = normalizeHookMatcher(matcher)
			if (normalizedMatcher) {
				validMatchers.push(normalizedMatcher)
			}
		}

		if (validMatchers.length > 0) {
			normalized[event] = validMatchers
		}
	}

	return normalized
}

/**
 * Normalize a single hook matcher entry
 */
function normalizeHookMatcher(matcher: unknown): HookMatcher | null {
	if (!matcher || typeof matcher !== "object") {
		return null
	}

	const m = matcher as Record<string, unknown>

	// Matcher string is required (can be empty string for "match all")
	if (typeof m.matcher !== "string") {
		return null
	}

	// Hooks array is required
	if (!Array.isArray(m.hooks)) {
		return null
	}

	const validHooks: HookMatcher["hooks"] = []
	for (const hook of m.hooks) {
		if (!hook || typeof hook !== "object") {
			continue
		}

		const h = hook as Record<string, unknown>

		// Type must be "command"
		if (h.type !== "command") {
			continue
		}

		// Command must be a non-empty string
		if (typeof h.command !== "string" || h.command.trim().length === 0) {
			continue
		}

		validHooks.push({
			type: "command",
			command: h.command,
			...(typeof h.timeout === "number" && h.timeout > 0 ? { timeout: h.timeout } : {}),
		})
	}

	if (validHooks.length === 0) {
		return null
	}

	return {
		matcher: m.matcher,
		hooks: validHooks,
	}
}

/**
 * Merge two hooks configurations
 * Project hooks are appended after global hooks for each event
 */
export function mergeHooksConfigs(global: HooksConfig, project: HooksConfig): HooksConfig {
	const merged: HooksConfig = {}

	const allEvents: HookEvent[] = [
		"PreToolUse",
		"PostToolUse",
		"PermissionRequest",
		"Notification",
		"UserPromptSubmit",
		"Stop",
		"PreCompact",
		"SessionStart",
		"SessionEnd",
	]

	for (const event of allEvents) {
		const globalMatchers = global[event] || []
		const projectMatchers = project[event] || []

		if (globalMatchers.length > 0 || projectMatchers.length > 0) {
			merged[event] = [...globalMatchers, ...projectMatchers]
		}
	}

	return merged
}

/**
 * Load hooks from both global and project configurations
 * @param workspace - Workspace directory path
 * @returns Merged hooks configuration
 */
export async function loadHooks(workspace?: string): Promise<HooksConfig> {
	// Load global hooks
	const globalHooks = await loadHooksFromFile(GLOBAL_CONFIG_FILE)
	logs.debug(`Loaded global hooks`, "HooksConfig", {
		events: Object.keys(globalHooks),
	})

	// Load project hooks if workspace is provided
	let projectHooks: HooksConfig = {}
	if (workspace) {
		const projectConfigPath = getProjectConfigPath(workspace)
		projectHooks = await loadHooksFromFile(projectConfigPath)
		logs.debug(`Loaded project hooks from ${projectConfigPath}`, "HooksConfig", {
			events: Object.keys(projectHooks),
		})
	}

	// Merge configurations
	const merged = mergeHooksConfigs(globalHooks, projectHooks)
	logs.debug(`Merged hooks configuration`, "HooksConfig", {
		events: Object.keys(merged),
	})

	return merged
}

/**
 * Get hooks for a specific event
 */
export function getHooksForEvent(hooks: HooksConfig, event: HookEvent): HookMatcher[] {
	return hooks[event] || []
}
