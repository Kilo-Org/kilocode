/* eslint no-misleading-character-class: 0 */
// kilocode_change: this file was pulled from Cline and adjusted for us

import { getAllModes } from "@roo/modes"
import { getBasename } from "./kilocode/path-webview"
import { Fzf } from "@/lib/word-boundary-fzf" // kilocode_change
import { ClineRulesToggles } from "@roo/cline-rules"

export type SlashCommandType = "command" | "mode" | "workflow" | "skill"
export type SlashCommandSource = "built-in" | "project" | "global" | "organization"

export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom"
	type?: SlashCommandType
	source?: SlashCommandSource
	argumentHint?: string
}

export interface SkillInfo {
	name: string
	description: string
	source: "global" | "project"
	argumentHint?: string
}

// Create a function to get all supported slash commands
export function getSupportedSlashCommands(
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	skills: SkillInfo[] = [],
): SlashCommand[] {
	// Start with non-mode commands
	const baseCommands: SlashCommand[] = [
		{
			name: "newtask",
			description: "Create a new task with context from the current task",
			type: "command",
			source: "built-in",
		},
		{
			name: "newrule",
			description: "Create a new Kilo rule with context from your conversation",
			type: "command",
			source: "built-in",
		},
		{ name: "reportbug", description: "Create a KiloCode GitHub issue", type: "command", source: "built-in" },
		// kilocode_change start
		{ name: "init", description: "Initialize Kilo Code for this workspace", type: "command", source: "built-in" },
		{ name: "smol", description: "Condenses your current context window", type: "command", source: "built-in" },
		{
			name: "condense",
			description: "Condenses your current context window",
			type: "command",
			source: "built-in",
		},
		{ name: "compact", description: "Condenses your current context window", type: "command", source: "built-in" },
		{
			name: "session",
			description: "Session management <fork|share|show>",
			type: "command",
			source: "built-in",
		},
		// kilocode_change end
	]

	// Add mode-switching commands dynamically
	const modeCommands = getAllModes(customModes).map((mode) => ({
		name: mode.slug,
		description: `Switch to ${mode.name.replace(/^[💻🏗️❓🪲🪃]+ /, "")} mode`,
		type: "mode" as const,
		source: (mode.source ?? "built-in") as SlashCommandSource,
	}))

	// add workflow commands
	const workflowCommands = getWorkflowCommands(localWorkflowToggles, globalWorkflowToggles)

	// add skill commands
	const skillCommands: SlashCommand[] = skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		section: "custom" as const,
		type: "skill" as const,
		source: skill.source as SlashCommandSource,
		...(skill.argumentHint && { argumentHint: skill.argumentHint }),
	}))

	return [...baseCommands, ...modeCommands, ...workflowCommands, ...skillCommands]
}

// Export a default instance for backward compatibility
export const SUPPORTED_SLASH_COMMANDS = getSupportedSlashCommands()

// Regex for detecting slash commands in text
export const slashCommandRegex = /\/([a-zA-Z0-9_.-]+)(\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")

/**
 * Determines whether the slash command menu should be displayed based on text input
 */
// kilocode_change start: Added workflow toggles parameters
export function shouldShowSlashCommandsMenu(
	text: string,
	cursorPosition: number,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	skills: SkillInfo[] = [],
): boolean {
	// kilocode_change end
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

	// kilocode_change start: If there are no matching commands for the current query, don't show the menu.
	// This prevents an empty menu from capturing Enter/Tab and blocking message submission.
	const matches = getMatchingSlashCommands(
		textAfterSlash,
		customModes,
		localWorkflowToggles,
		globalWorkflowToggles,
		skills,
	)
	return matches.length > 0
	// kilocode_change end
}

function enabledWorkflowToggles(workflowToggles: ClineRulesToggles, source: "project" | "global"): SlashCommand[] {
	return Object.entries(workflowToggles)
		.filter(([_, enabled]) => enabled)
		.map(([filePath, _]) => ({
			name: getBasename(filePath),
			section: "custom" as const,
			type: "workflow" as const,
			source,
		}))
}

export function getWorkflowCommands(
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
): SlashCommand[] {
	return [
		...enabledWorkflowToggles(localWorkflowToggles, "project"),
		...enabledWorkflowToggles(globalWorkflowToggles, "global"),
	]
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	skills: SkillInfo[] = [],
): SlashCommand[] {
	const commands = getSupportedSlashCommands(customModes, localWorkflowToggles, globalWorkflowToggles, skills)

	if (!query) {
		return [...commands]
	}

	// kilocode_change start: Use Fzf for case-insensitive word-boundary fuzzy matching
	const fzf = new Fzf(commands, {
		selector: (cmd: SlashCommand) => cmd.name,
	})
	return fzf.find(query).map((result) => result.item)
	// kilocode_change end: Use Fzf for case-insensitive word-boundary fuzzy matching
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
 * Returns partial if we have a fuzzy match against valid commands, or full for exact match
 */
export function validateSlashCommand(
	command: string,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	skills: SkillInfo[] = [],
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	const commands = getSupportedSlashCommands(customModes, localWorkflowToggles, globalWorkflowToggles, skills)

	// Check for exact match (command name equals query, case-insensitive via FZF)
	const lowerCommand = command.toLowerCase()
	const exactMatch = commands.some((cmd) => cmd.name.toLowerCase() === lowerCommand)
	if (exactMatch) {
		return "full"
	}

	// kilocode_change start: Use FZF for consistent fuzzy matching with getMatchingSlashCommands
	const fzf = new Fzf(commands, {
		selector: (cmd: SlashCommand) => cmd.name,
	})
	const results = fzf.find(command)
	if (results.length > 0) {
		return "partial"
	}
	// kilocode_change end: Use FZF for consistent fuzzy matching with getMatchingSlashCommands

	return null // no match
}

// kilocode_change start: Find matching slash command to get its type for highlighting
export function findSlashCommand(
	command: string,
	customModes?: any[],
	localWorkflowToggles: ClineRulesToggles = {},
	globalWorkflowToggles: ClineRulesToggles = {},
	skills: SkillInfo[] = [],
): SlashCommand | null {
	if (!command) {
		return null
	}

	const commands = getSupportedSlashCommands(customModes, localWorkflowToggles, globalWorkflowToggles, skills)
	const lowerCommand = command.toLowerCase()
	return commands.find((cmd) => cmd.name.toLowerCase() === lowerCommand) ?? null
}
// kilocode_change end
