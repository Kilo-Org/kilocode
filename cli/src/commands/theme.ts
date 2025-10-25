/**
 * /theme command - Switch between different themes
 */

import type { Command, ArgumentProviderContext } from "./core/types.js"
import type { CLIConfig } from "../config/types.js"
import { getThemeById, getAvailableThemes } from "../constants/themes/index.js"
import { getBuiltinThemeIds } from "../constants/themes/custom.js"
import { messageResetCounterAtom } from "../state/atoms/ui.js"
import { createStore } from "jotai"

/**
 * Get config from disk
 */
async function getConfig(): Promise<{ config: CLIConfig }> {
	const { loadConfig } = await import("../config/persistence.js")
	const { config } = await loadConfig()
	return { config }
}

/**
 * Autocomplete provider for theme names
 */
async function themeAutocompleteProvider(_context: ArgumentProviderContext) {
	const { config } = await getConfig()
	const availableThemeIds = getAvailableThemes(config)

	// Create theme display info array to apply same sorting logic
	const sortedThemes = availableThemeIds
		.map((themeId) => {
			const theme = getThemeById(themeId, config)
			return {
				id: themeId,
				name: theme.name,
				description: theme.type,
				type: theme.type,
			}
		})
		.sort((a, b) => {
			// Sort by type (Dark first, then Light, then Custom), then by ID alphabetically
			const typeOrder = { Dark: 0, Light: 1, Custom: 2 }
			const typeAOrder = typeOrder[a.type as keyof typeof typeOrder] ?? 3
			const typeBOrder = typeOrder[b.type as keyof typeof typeOrder] ?? 3

			if (typeAOrder !== typeBOrder) {
				return typeAOrder - typeBOrder
			}
			return a.id.localeCompare(b.id)
		})

	return sortedThemes
		.map((theme) => {
			return {
				value: theme.id,
				title: theme.name,
				description: theme.description,
				matchScore: 1.0,
				highlightedValue: theme.id,
			}
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
}

/**
 * Get theme information for display with themes already sorted by getAvailableThemes
 */
function getThemeDisplayInfo(config: CLIConfig) {
	// getAvailableThemes already returns themes in the correct order
	const availableThemeIds = getAvailableThemes(config)

	return availableThemeIds.map((themeId) => {
		const theme = getThemeById(themeId, config)
		return {
			id: themeId,
			name: theme.name,
			description: theme.type,
			type: theme.type,
		}
	})
}

export const themeCommand: Command = {
	name: "theme",
	aliases: ["th"],
	description: "Switch to a different theme",
	usage: "/theme [theme-name]",
	examples: ["/theme dark", "/theme light", "/theme alpha"],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "theme-name",
			description: "The theme to switch to (optional for interactive selection)",
			required: false,
			placeholder: "Select a theme",
			provider: themeAutocompleteProvider,
			/**
			 * Validate theme argument against available themes
			 */
			validate: async (value, _context) => {
				const { config } = await getConfig()
				const availableThemeIds = getAvailableThemes(config)
				const isValid = availableThemeIds.includes(value.trim().toLowerCase())

				return {
					valid: isValid,
					...(isValid ? {} : { error: `Invalid theme. Available themes: ${availableThemeIds.join(", ")}` }),
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setTheme } = context
		const { config } = await getConfig()
		const availableThemeIds = getAvailableThemes(config)

		try {
			// If no theme provided, show available themes
			if (args.length === 0 || !args[0]) {
				// Get theme display info with custom themes
				const allThemes = getThemeDisplayInfo(config)

				// Group themes by type using a map
				const themesByType = allThemes.reduce(
					(acc, theme) => {
						if (!acc[theme.type]) {
							acc[theme.type] = []
						}
						acc[theme.type].push(theme)
						return acc
					},
					{} as Record<string, Array<{ id: string; name: string; description: string; type: string }>>,
				)

				// Define the order for displaying theme types
				const typeOrder = ["Dark", "Light", "Custom"]

				// Show interactive theme selection menu
				const helpText: string[] = ["**Available Themes:**", ""]

				// Loop through theme types in the specified order
				typeOrder.forEach((type) => {
					const themes = themesByType[type] || []
					if (themes.length > 0) {
						helpText.push(`**${type}:**`)
						themes.forEach((theme) => {
							helpText.push(`  ${theme.name} (${theme.id})`)
						})
						helpText.push("")
					}
				})

				helpText.push("Usage: /theme <theme-name>")

				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: helpText.join("\n"),
					ts: Date.now(),
				})
				return
			}

			const requestedTheme = args[0].toLowerCase()

			if (!availableThemeIds.includes(requestedTheme)) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Invalid theme "${requestedTheme}". Available themes: ${availableThemeIds.join(", ")}`,
					ts: Date.now(),
				})
				return
			}

			// Find the theme to get its display name
			const theme = getThemeById(requestedTheme, config)
			const themeName = theme.name || requestedTheme

			try {
				await setTheme(requestedTheme)

				// Repaint the terminal to immediately show theme changes
				// Clear the terminal screen and reset cursor position
				// \x1b[2J - Clear entire screen
				// \x1b[3J - Clear scrollback buffer (needed for gnome-terminal)
				// \x1b[H - Move cursor to home position (0,0)
				process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

				// Increment reset counter to force UI re-render
				const store = createStore()
				store.set(messageResetCounterAtom, (prev: number) => prev + 1)

				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: `Switched to **${themeName}** theme.`,
					ts: Date.now(),
				})
			} catch (error) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Failed to switch to **${themeName}** theme: ${error instanceof Error ? error.message : String(error)}`,
					ts: Date.now(),
				})
			}
		} catch (error) {
			// Handler-level error for unexpected issues (e.g., config corruption)
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Theme command failed: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
		}
	},
}
