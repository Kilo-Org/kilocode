/**
 * Modes API command - Exposes available modes as JSON for programmatic use
 *
 * Usage:
 *   kilocode modes [list] [--workspace <path>]
 *
 * Output format:
 *   {
 *     "current": "code",
 *     "workspace": "/path/to/workspace",
 *     "modes": [
 *       {
 *         "slug": "code",
 *         "name": "Code",
 *         "description": "Write and update code",
 *         "source": "built-in",
 *         "isCurrent": true
 *       }
 *     ]
 *   }
 */

import { createStore } from "jotai"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import { resolve } from "path"
import { parse } from "yaml"
import { loadConfigAtom } from "../state/atoms/config.js"
import { logs } from "../services/logs.js"
import { DEFAULT_MODES, getAllModes } from "../constants/modes/defaults.js"
import { loadCustomModes, getSearchedPaths, type SearchedPath } from "../config/customModes.js"
import type { ModeConfig } from "../types/messages.js"

/**
 * Output format for the modes API command
 */
export interface ModesApiOutput {
	current: string
	workspace: string
	modes: Array<{
		slug: string
		name: string
		description: string | null
		source: "built-in" | "global" | "project" | "organization"
		isCurrent: boolean
	}>
}

/**
 * Error output format
 */
export interface ModesApiError {
	error: string
	code: string
}

/**
 * Options for the modes API command
 */
export interface ModesApiOptions {
	workspace?: string
}

const DEFAULT_MODE_SLUGS = new Set(DEFAULT_MODES.map((mode) => mode.slug))

function hasNonCommentContent(content: string): boolean {
	return content.split("\n").some((line) => {
		const trimmed = line.trim()
		return trimmed !== "" && !trimmed.startsWith("#")
	})
}

export function resolveModeSource(
	mode: ModeConfig,
	defaultModeSlugs: Set<string> = DEFAULT_MODE_SLUGS,
): "built-in" | "global" | "project" | "organization" {
	if (defaultModeSlugs.has(mode.slug) && !mode.source) {
		return "built-in"
	}
	if (!mode.source) {
		return "global"
	}
	return mode.source
}

export function buildModesOutput(params: {
	currentMode: string
	workspace: string
	modes: ModeConfig[]
}): ModesApiOutput {
	return {
		current: params.currentMode,
		workspace: params.workspace,
		modes: params.modes.map((mode) => ({
			slug: mode.slug,
			name: mode.name,
			description: mode.description ?? null,
			source: resolveModeSource(mode),
			isCurrent: mode.slug === params.currentMode,
		})),
	}
}

async function validateCustomModesConfig(searchedPaths: SearchedPath[]): Promise<string | null> {
	for (const searched of searchedPaths) {
		if (!searched.found) {
			continue
		}

		let content: string
		try {
			content = await readFile(searched.path, "utf-8")
		} catch (error) {
			logs.debug("Failed to read custom modes file", "ModesAPI", { path: searched.path, error })
			return `Unable to read custom modes configuration at ${searched.path}`
		}

		if (!hasNonCommentContent(content)) {
			continue
		}

		let parsed: unknown
		try {
			parsed = parse(content)
		} catch (error) {
			logs.debug("Failed to parse custom modes file", "ModesAPI", { path: searched.path, error })
			return `Invalid custom modes configuration at ${searched.path}`
		}

		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return `Invalid custom modes configuration at ${searched.path}`
		}

		const { customModes } = parsed as { customModes?: unknown }
		// Allow null/undefined (treated as empty array by parseCustomModes)
		if (customModes !== null && customModes !== undefined && !Array.isArray(customModes)) {
			return `Invalid custom modes configuration at ${searched.path}`
		}
	}

	return null
}

/**
 * Output result as JSON to stdout
 */
function outputJson(data: ModesApiOutput | ModesApiError): void {
	console.log(JSON.stringify(data, null, 2))
}

/**
 * Output error and exit
 */
function outputError(message: string, code: string): never {
	outputJson({ error: message, code })
	process.exit(1)
}

/**
 * Main modes API command handler
 */
export async function modesApiCommand(options: ModesApiOptions = {}): Promise<void> {
	try {
		const workspace = resolve(options.workspace || process.cwd())

		if (!existsSync(workspace)) {
			outputError(`Workspace path does not exist: ${workspace}`, "WORKSPACE_NOT_FOUND")
		}

		logs.info("Starting modes API command", "ModesAPI", { workspace })

		const store = createStore()
		const config = await store.set(loadConfigAtom)

		const customModes = await loadCustomModes(workspace)
		const validationError = await validateCustomModesConfig(getSearchedPaths())
		if (validationError) {
			outputError(validationError, "INVALID_MODES_CONFIG")
		}

		const allModes = getAllModes(customModes)
		const output = buildModesOutput({
			currentMode: config.mode,
			workspace,
			modes: allModes,
		})

		outputJson(output)

		logs.info("Modes API command completed successfully", "ModesAPI", {
			modeCount: output.modes.length,
		})
	} catch (error) {
		logs.error("Modes API command failed", "ModesAPI", { error })
		outputError(error instanceof Error ? error.message : "An unexpected error occurred", "INTERNAL_ERROR")
	}

	process.exit(0)
}
