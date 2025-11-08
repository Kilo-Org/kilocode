import * as path from "path"
import * as vscode from "vscode"
import { promises as fs } from "fs"

import type { ModeConfig } from "@roo-code/types"
import type { ToolUseStyle } from "@roo-code/types" // kilocode_change

import { getAllModesWithPrompts } from "../../../shared/modes"

export async function getModesSection(
	context: vscode.ExtensionContext,
	toolUseStyle?: ToolUseStyle, // kilocode_change
): Promise<string> {
	const settingsDir = path.join(context.globalStorageUri.fsPath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })

	// Get all modes with their overrides from extension state
	const allModes = await getAllModesWithPrompts(context)

	let modesContent = `====

MODES

- These are the currently available modes:
${allModes
	.map((mode: ModeConfig) => {
		let description: string
		if (mode.whenToUse && mode.whenToUse.trim() !== "") {
			// Use whenToUse as the primary description, indenting subsequent lines for readability
			description = mode.whenToUse.replace(/\n/g, "\n    ")
		} else {
			// Fallback to the first sentence of roleDefinition if whenToUse is not available
			description = mode.roleDefinition.split(".")[0]
		}
		return `  * "${mode.name}" mode (${mode.slug}) - ${description}`
	})
	.join("\n")}`

	// kilocode_change: toolUseStyle
	modesContent += `
If the user asks you to create or edit a new mode for this project, you should read the instructions by using the fetch_instructions tool${toolUseStyle !== "json" ? ", like this:\n<fetch_instructions>\n<task>create_mode</task>\n</fetch_instructions>" : "."}`

	return modesContent
}
