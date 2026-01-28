import { Box, Text } from "ink"
import fuzzysort from "fuzzysort"

import { GlobalCommandAction } from "@/lib/utils/commands.js"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface SlashCommandResult extends AutocompleteItem {
	name: string
	description?: string
	argumentHint?: string
	source: "global" | "project" | "built-in"
	/** Action to trigger for CLI global commands (e.g., clearTask for /new) */
	action?: GlobalCommandAction
}

export interface SlashCommandTriggerConfig {
	getCommands: () => SlashCommandResult[]
	maxResults?: number
}

/**
 * Create a slash command trigger for / commands.
 *
 * This trigger activates when the user types / at the start of a line,
 * and allows selecting commands with local fuzzy filtering.
 *
 * @param config - Configuration for the trigger
 * @returns AutocompleteTrigger for slash commands
 */
export function createSlashCommandTrigger(config: SlashCommandTriggerConfig): AutocompleteTrigger<SlashCommandResult> {
	const { getCommands, maxResults = 20 } = config

	return {
		id: "slash-command",
		triggerChar: "/",
		position: "line-start",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Check if line starts with / (after optional whitespace)
			const trimmed = lineText.trimStart()

			if (!trimmed.startsWith("/")) {
				return null
			}

			// Extract query after /
			const query = trimmed.substring(1)

			// Close picker if query contains space (command complete)
			if (query.includes(" ")) {
				return null
			}

			// Calculate trigger index (position of / in original line)
			const triggerIndex = lineText.length - trimmed.length

			return { query, triggerIndex }
		},

		search: (query: string): SlashCommandResult[] => {
			const allCommands = getCommands()

			if (query.length === 0) {
				// Show all commands when just "/" is typed
				return allCommands.slice(0, maxResults)
			}

			// Fuzzy search by command name
			const results = fuzzysort.go(query, allCommands, {
				key: "name",
				limit: maxResults,
				threshold: -10000, // Be lenient with matching
			})

			return results.map((result) => result.obj)
		},

		renderItem: (item: SlashCommandResult, isSelected: boolean) => {
			// Source indicator icons:
			// ⚙️ for action commands (CLI global), ⚡ built-in, 📁 project, 🌐 global (content)
			const sourceIcon = item.action
				? "⚙️"
				: item.source === "built-in"
					? "⚡"
					: item.source === "project"
						? "📁"
						: "🌐"

			return (
				<Box paddingLeft={2}>
					<Text color={isSelected ? "cyan" : undefined}>
						{sourceIcon} /{item.name}
						{item.description && <Text dimColor> - {item.description}</Text>}
					</Text>
				</Box>
			)
		},

		getReplacementText: (item: SlashCommandResult, lineText: string, triggerIndex: number): string => {
			const beforeSlash = lineText.substring(0, triggerIndex)
			return `${beforeSlash}/${item.name} `
		},

		emptyMessage: "No matching commands found",
		debounceMs: 150,
	}
}

/**
 * Convert external command data to SlashCommandResult.
 * Use this to adapt commands from the store to the trigger's expected type.
 */
export function toSlashCommandResult(command: {
	name: string
	description?: string
	argumentHint?: string
	source: "global" | "project" | "built-in"
	action?: string
}): SlashCommandResult {
	return {
		key: command.name,
		name: command.name,
		description: command.description,
		argumentHint: command.argumentHint,
		source: command.source,
		action: command.action as GlobalCommandAction | undefined,
	}
}
