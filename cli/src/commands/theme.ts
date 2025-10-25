/**
 * /theme command - Switch between different themes
 */

import type { Command, ArgumentProviderContext } from "./core/types.js"
import type { CLIConfig } from "../config/types.js"
import { getThemeById, getAvailableThemes } from "../constants/themes/index.js"
import { isCustomTheme, getBuiltinThemeIds } from "../constants/themes/custom.js"

// Define theme type mapping based on specifications
const THEME_TYPES: Record<string, string> = {
	// Default kilo themes
	dark: "Dark",
	light: "Light",
	alpha: "Dark",

	// Dark themes
	ansi: "Dark",
	"atom-one-dark": "Dark",
	"ayu-dark": "Dark",
	dracula: "Dark",
	"github-dark": "Dark",
	"shades-of-purple": "Dark",

	// Light themes
	"ansi-light": "Light",
	"ayu-light": "Light",
	"github-light": "Light",
	googlecode: "Light",
	xcode: "Light",
}

/**
 * Autocomplete provider for theme names
 */
async function themeAutocompleteProvider(_context: ArgumentProviderContext) {
	try {
		const { loadConfig } = await import("../config/persistence.js")
		const { config } = await loadConfig()
		const availableThemeIds = getAvailableThemes(config)

		return availableThemeIds
			.map((themeId) => {
				const theme = getThemeById(themeId, config)
				const description = isCustomTheme(themeId, config) ? "Custom" : THEME_TYPES[themeId] || "Unknown"

				return {
					value: themeId,
					title: theme.name,
					description: description,
					matchScore: 1.0,
					highlightedValue: themeId,
				}
			})
			.filter((item): item is NonNullable<typeof item> => item !== null)
	} catch (_error) {
		// Fallback to built-in themes if we can't load config
		return getBuiltinThemeIds()
			.map((themeId) => {
				const theme = getThemeById(themeId)
				const description = THEME_TYPES[themeId] || "Unknown"

				return {
					value: themeId,
					title: theme.name,
					description: description,
					matchScore: 1.0,
					highlightedValue: themeId,
				}
			})
			.filter((item): item is NonNullable<typeof item> => item !== null)
	}
}

/**
 * Get theme information for display and sort
 */
function getThemeDisplayInfo(config: CLIConfig) {
	const availableThemeIds = getAvailableThemes(config)

	return availableThemeIds
		.map((themeId) => {
			const theme = getThemeById(themeId, config)
			const themeType = isCustomTheme(themeId, config) ? "Custom" : THEME_TYPES[themeId] || "Dark"
			return {
				id: themeId,
				name: theme.name,
				description: themeType,
				type: themeType,
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
			validate: (_value, _context) => {
				// For validation, we need to check against actual available themes
				// This is a simplified check - in practice we should load the actual config
				const isValid = true // Default to true for now, actual validation happens in handler
				return {
					valid: isValid,
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setTheme } = context
		// Note: For now we need to load the actual config from the persistence layer
		// In a real implementation, config should be passed in the context
		const { loadConfig } = await import("../config/persistence.js")
		const { config } = await loadConfig()
		const availableThemeIds = getAvailableThemes(config)

		if (args.length === 0 || !args[0]) {
			// Get theme display info with custom themes
			const allThemes = getThemeDisplayInfo(config)

			// Group themes by type
			const lightThemes = allThemes.filter((theme) => theme.type === "Light")
			const darkThemes = allThemes.filter((theme) => theme.type === "Dark")
			const customThemes = allThemes.filter((theme) => theme.type === "Custom")

			// Show interactive theme selection menu
			const helpText: string[] = ["**Available Themes:**", ""]

			// Dark themes section
			if (darkThemes.length > 0) {
				helpText.push("**Dark:**")
				darkThemes.forEach((theme) => {
					helpText.push(`  ${theme.name} (${theme.id})`)
				})
				helpText.push("")
			}

			// Light themes section
			if (lightThemes.length > 0) {
				helpText.push("**Light:**")
				lightThemes.forEach((theme) => {
					helpText.push(`  ${theme.name} (${theme.id})`)
				})
				helpText.push("")
			}

			// Custom themes section
			if (customThemes.length > 0) {
				helpText.push("**Custom:**")
				customThemes.forEach((theme) => {
					helpText.push(`  ${theme.name} (${theme.id})`)
				})
				helpText.push("")
			}

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
