import { Box, Text } from "ink"
import fuzzysort from "fuzzysort"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface ModeResult extends AutocompleteItem {
	slug: string
	name: string
	description?: string
	icon?: string
}

export interface ModeTriggerConfig {
	getModes: () => ModeResult[]
	maxResults?: number
}

/**
 * Create a mode trigger for ! mode switching.
 *
 * This trigger activates when the user types ! at the start of a line,
 * and allows selecting modes with local fuzzy filtering.
 *
 * @param config - Configuration for the trigger
 * @returns AutocompleteTrigger for mode switching
 */
export function createModeTrigger(config: ModeTriggerConfig): AutocompleteTrigger<ModeResult> {
	const { getModes, maxResults = 20 } = config

	return {
		id: "mode",
		triggerChar: "!",
		position: "line-start",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Check if line starts with ! (after optional whitespace)
			const trimmed = lineText.trimStart()

			if (!trimmed.startsWith("!")) {
				return null
			}

			// Extract query after !
			const query = trimmed.substring(1)

			// Close picker if query contains space (mode selection complete)
			if (query.includes(" ")) {
				return null
			}

			// Calculate trigger index (position of ! in original line)
			const triggerIndex = lineText.length - trimmed.length

			return { query, triggerIndex }
		},

		search: (query: string): ModeResult[] => {
			const allModes = getModes()

			if (query.length === 0) {
				// Show all modes when just "!" is typed
				return allModes.slice(0, maxResults)
			}

			// Fuzzy search by mode name and slug
			const results = fuzzysort.go(query, allModes, {
				keys: ["name", "slug"],
				limit: maxResults,
				threshold: -10000, // Be lenient with matching
			})

			return results.map((result) => result.obj)
		},

		renderItem: (item: ModeResult, isSelected: boolean) => {
			return (
				<Box paddingLeft={2}>
					<Text color={isSelected ? "cyan" : undefined}>
						{item.name}
						{item.description && <Text dimColor> - {item.description}</Text>}
					</Text>
				</Box>
			)
		},

		getReplacementText: (_item: ModeResult, _lineText: string, _triggerIndex: number): string => {
			// Replace the entire input with just a space (mode will be switched via message)
			// This clears the picker trigger from the input
			return ""
		},

		emptyMessage: "No matching modes found",
		debounceMs: 150,
	}
}

/**
 * Convert external mode data to ModeTriggerResult.
 * Use this to adapt modes from the store to the trigger's expected type.
 */
export function toModeResult(mode: { slug: string; name: string; description?: string; icon?: string }): ModeResult {
	return {
		key: mode.slug,
		slug: mode.slug,
		name: mode.name,
		description: mode.description,
		icon: mode.icon,
	}
}
