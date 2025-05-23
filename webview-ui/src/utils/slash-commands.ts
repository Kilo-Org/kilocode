// kilocode_change: this file was pulled from Cline and adjusted for us

import { getAllModes } from "@roo/shared/modes"

export interface SlashCommand {
	name: string
	description?: string // kilocode_change
	section?: "default" | "custom" // kilocode_change
}

// Create a function to get all supported slash commands
export function getSupportedSlashCommands(
	customModes?: any[],
	workflowToggles: Record<string, boolean> = {}, // kilocode_change
): SlashCommand[] {
	// Start with non-mode commands
	const baseCommands: SlashCommand[] = [
		{
			name: "newtask",
			description: "Create a new task with context from the current task",
		},
		{
			name: "newrule",
			description: "Create a new Kilo rule with context from your conversation",
		},
		{ name: "reportbug", description: "Create a KiloCode GitHub issue" },
		{ name: "smol", description: "Condenses your current context window" },
		// kilocode_change end
	]

	// Add mode-switching commands dynamically
	const modeCommands = getAllModes(customModes).map((mode) => ({
		name: mode.slug,
		description: `Switch to ${mode.name.replace(/^[��️❓��]+ /, "")} mode`,
	}))

	// add workflow commands
	const workflowCommands = getWorkflowCommands(workflowToggles) // kilocode_change
	return [...baseCommands, ...modeCommands, ...workflowCommands] // kilocode_change
}

// Export a default instance for backward compatibility
export const SUPPORTED_SLASH_COMMANDS = getSupportedSlashCommands()

// Regex for detecting slash commands in text
export const slashCommandRegex = /\/([a-zA-Z0-9_.-]+)(\s|$)/ // kilocode_change
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")

/**
 * Determines whether the slash command menu should be displayed based on text input
 */
export function shouldShowSlashCommandsMenu(text: string, cursorPosition: number): boolean {
	const beforeCursor = text.slice(0, cursorPosition)

	// first check if there is a slash before the cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return false
	}

	// check if slash is at the very beginning (with optional whitespace)
	const textBeforeSlash = beforeCursor.slice(0, slashIndex)
	if (!/^\s*$/.test(textBeforeSlash)) {
		return false
	}

	// potential partial or full command
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// don't show menu if there's whitespace after the slash but before the cursor
	if (/\s/.test(textAfterSlash)) {
		return false
	}

	return true
}

// kilocode_change start
export function getWorkflowCommands(workflowToggles: Record<string, boolean>): SlashCommand[] {
	return Object.entries(workflowToggles)
		.filter(([_, enabled]) => enabled)
		.map(([filePath, _]) => {
			// potentially remove the file extension if there is one, but this would then require
			// that we prevent users from having the same fname with different extensions
			const fileName = filePath.replace(/^.*[/\\]/, "")

			return {
				name: fileName,
				section: "custom",
			}
		})
}
// kilocode_change end

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	customModes?: any[],
	workflowToggles: Record<string, boolean> = {}, // kilocode_change
): SlashCommand[] {
	const commands = getSupportedSlashCommands(customModes, workflowToggles)

	if (!query) {
		return [...commands]
	}

	// filter commands that start with the query (case sensitive)
	return commands.filter((cmd) => cmd.name.startsWith(query))
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(text: string, commandName: string): { newValue: string; commandIndex: number } {
	const slashIndex = text.indexOf("/")

	// where the command ends, at the end of entire text or first space
	const commandEndIndex = text.indexOf(" ", slashIndex)

	// replace the partial command with the full command
	const newValue =
		text.substring(0, slashIndex + 1) + commandName + (commandEndIndex > -1 ? text.substring(commandEndIndex) : " ") // add extra space at the end if only slash command

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a partial match against valid commands, or full for full match
 */
export function validateSlashCommand(
	command: string,
	customModes?: any[],
	workflowToggles: Record<string, boolean> = {}, // kilocode_change
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	// case sensitive matching
	const commands = getSupportedSlashCommands(customModes, workflowToggles) // kilocode_change

	const exactMatch = commands.some((cmd) => cmd.name === command)

	if (exactMatch) {
		return "full"
	}

	const partialMatch = commands.some((cmd) => cmd.name.startsWith(command))

	if (partialMatch) {
		return "partial"
	}

	return null // no match
}
