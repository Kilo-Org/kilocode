/**
 * /theme command - Switch between different themes
 */

import type { Command, ArgumentValue } from "./core/types.js"
import { getAvailableThemes, getThemeById } from "../constants/themes/index.js"

// Get theme information for display
const THEMES = getAvailableThemes().map((themeId) => {
	const theme = getThemeById(themeId)
	return {
		id: themeId,
		name: theme.name,
		description: theme.name,
	}
})

// Convert themes to ArgumentValue format
const THEME_VALUES: ArgumentValue[] = THEMES.map((theme) => ({
	value: theme.id,
	description: theme.description,
}))

// Extract theme IDs for validation
const AVAILABLE_THEME_IDS = getAvailableThemes()

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
			values: THEME_VALUES,
			placeholder: "Select a theme",
			validate: (value) => {
				const isValid = AVAILABLE_THEME_IDS.includes(value.toLowerCase())
				return {
					valid: isValid,
					...(isValid ? {} : { error: `Invalid theme. Available: ${AVAILABLE_THEME_IDS.join(", ")}` }),
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setTheme } = context

		if (args.length === 0 || !args[0]) {
			// Show interactive theme selection menu
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: [
					"**Available Themes:**",
					"",
					...THEMES.map((theme) => `  - **${theme.name}** (${theme.id})`),
					"",
					"Usage: /theme <theme-name>",
				].join("\n"),
				ts: Date.now(),
			})
			return
		}

		const requestedTheme = args[0].toLowerCase()

		if (!AVAILABLE_THEME_IDS.includes(requestedTheme)) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Invalid theme "${requestedTheme}". Available themes: ${AVAILABLE_THEME_IDS.join(", ")}`,
				ts: Date.now(),
			})
			return
		}

		// Find the theme to get its display name
		const theme = getThemeById(requestedTheme)
		const themeName = theme.name || requestedTheme

		try {
			await setTheme(requestedTheme)

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
	},
}
