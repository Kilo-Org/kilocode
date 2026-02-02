import { Box, Text } from "ink"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

/**
 * Help shortcut result type.
 * Represents a keyboard shortcut or trigger hint.
 */
export interface HelpShortcutResult extends AutocompleteItem {
	/** The shortcut key or trigger character */
	shortcut: string
	/** Description of what the shortcut does */
	description: string
}

/**
 * Built-in shortcuts to display in the help menu.
 */
const HELP_SHORTCUTS: HelpShortcutResult[] = [
	{ key: "slash", shortcut: "/", description: "for commands" },
	{ key: "at", shortcut: "@", description: "for file paths" },
	{ key: "bang", shortcut: "!", description: "for modes" },
	{ key: "hash", shortcut: "#", description: "for task history" },
	{ key: "newline", shortcut: "shift + ⏎", description: "for newline" },
	{ key: "focus", shortcut: "tab", description: "to toggle focus" },
	{ key: "mode", shortcut: "ctrl + m", description: "to cycle modes" },
	{ key: "todos", shortcut: "ctrl + t", description: "to view TODO list" },
	{ key: "quit", shortcut: "ctrl + c", description: "to quit" },
]

/**
 * Create a help trigger for ? shortcuts menu.
 *
 * This trigger activates when the user types ? at the start of a line,
 * and displays a menu of available keyboard shortcuts.
 *
 * @returns AutocompleteTrigger for help shortcuts
 */
export function createHelpTrigger(): AutocompleteTrigger<HelpShortcutResult> {
	return {
		id: "help",
		triggerChar: "?",
		position: "line-start",
		consumeTrigger: true,

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Check if line starts with ? (after optional whitespace)
			const trimmed = lineText.trimStart()

			if (!trimmed.startsWith("?")) {
				return null
			}

			// Extract query after ?
			const query = trimmed.substring(1)

			// Close picker if query contains space
			if (query.includes(" ")) {
				return null
			}

			// Calculate trigger index (position of ? in original line)
			const triggerIndex = lineText.length - trimmed.length

			return { query, triggerIndex }
		},

		search: (query: string): HelpShortcutResult[] => {
			if (query.length === 0) {
				// Show all shortcuts when just "?" is typed
				return HELP_SHORTCUTS
			}

			// Filter shortcuts based on query
			const lowerQuery = query.toLowerCase()
			return HELP_SHORTCUTS.filter(
				(item) =>
					item.shortcut.toLowerCase().includes(lowerQuery) ||
					item.description.toLowerCase().includes(lowerQuery),
			)
		},

		renderItem: (item: HelpShortcutResult, isSelected: boolean) => {
			return (
				<Box paddingLeft={2}>
					<Text color={isSelected ? "cyan" : undefined}>
						<Text bold color={isSelected ? "cyan" : "yellow"}>
							{item.shortcut}
						</Text>
						<Text> {item.description}</Text>
					</Text>
				</Box>
			)
		},

		getReplacementText: (item: HelpShortcutResult, _lineText: string, _triggerIndex: number): string => {
			// When a shortcut is selected, replace with the trigger character
			// For action shortcuts (tab, ctrl+c, shift+enter, ctrl+t), just clear the input
			if (["newline", "focus", "quit", "todos"].includes(item.key)) {
				return ""
			}
			// For trigger shortcuts (/, @, !), insert the trigger character
			return item.shortcut
		},

		emptyMessage: "No matching shortcuts",
		debounceMs: 0, // No debounce needed for static list
	}
}
