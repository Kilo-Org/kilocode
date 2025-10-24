/**
 * /theme command - Switch between different themes
 */

import type { Command, ArgumentProviderContext } from "./core/types.js"
import type { CLIConfig } from "../config/types.js"
import { getThemeById, getAvailableThemes } from "../constants/themes/index.js"
import { isCustomTheme, getBuiltinThemeIds } from "../constants/themes/custom.js"
import { logs } from "../services/logs.js"

// Define theme type mapping based on theme specifications
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
 * Get theme type (Dark/Light/Custom) for a theme
 */
function getThemeType(themeId: string, config: CLIConfig): string {
	if (isCustomTheme(themeId, config)) {
		return "Custom"
	}
	return THEME_TYPES[themeId] || "Dark"
}

// Cache for config to improve performance
let configCache: { config: CLIConfig | null; timestamp: number } | null = null
const CONFIG_CACHE_TTL = 5000 // 5 seconds

/**
 * Get config with caching to improve performance
 *
 * Error scenarios handled:
 * - Config file not found: Uses DEFAULT_CONFIG
 * - Config file corrupted/unreadable: Falls back to DEFAULT_CONFIG
 * - Network/permission issues: Falls back to DEFAULT_CONFIG with shorter cache
 * - Invalid config structure: Relies on loadConfig's built-in validation/defaults
 *
 * Follows the same error handling pattern as other config operations in persistence.ts
 */
async function getConfigWithCache(): Promise<{ config: CLIConfig }> {
	const now = Date.now()

	// Return cached config if it's still valid
	if (configCache && configCache.config && now - configCache.timestamp < CONFIG_CACHE_TTL) {
		return { config: configCache.config }
	}

	try {
		const { loadConfig } = await import("../config/persistence.js")
		const { config } = await loadConfig()

		// Update cache
		configCache = {
			config,
			timestamp: now,
		}

		return { config }
	} catch (error) {
		// Log the error following the same pattern as persistence.ts
		logs.warn("Failed to load config for theme autocomplete, using built-in themes", "ThemeCommand", {
			error: error instanceof Error ? error.message : String(error),
		})

		// Use default config when loading fails
		const { DEFAULT_CONFIG } = await import("../config/defaults.js")
		const fallbackConfig = {
			...DEFAULT_CONFIG,
			customThemes: {}, // Ensure customThemes exists even in fallback
		}

		// Cache the fallback with shorter TTL to retry loading sooner
		configCache = {
			config: fallbackConfig,
			timestamp: now - CONFIG_CACHE_TTL / 2, // Cache for half the normal time
		}

		return { config: fallbackConfig }
	}
}

/**
 * Autocomplete provider for theme names
 *
 * Error scenarios handled:
 * - Config loading failure: Falls back to empty custom themes, uses built-in themes only
 * - Invalid theme objects: Skips malformed themes in the suggestion list
 */
async function themeAutocompleteProvider(_context: ArgumentProviderContext) {
	const { config } = await getConfigWithCache()
	const availableThemeIds = getAvailableThemes(config)

	return availableThemeIds
		.map((themeId) => {
			const theme = getThemeById(themeId, config)
			const description = getThemeType(themeId, config)

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

/**
 * Get theme information for display and sort
 */
function getThemeDisplayInfo(config: CLIConfig) {
	const availableThemeIds = getAvailableThemes(config)

	return availableThemeIds
		.map((themeId) => {
			const theme = getThemeById(themeId, config)
			const themeType = getThemeType(themeId, config)
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
			/**
			 * Validate theme argument against available themes
			 *
			 * Error scenarios handled:
			 * - Config loading failure: Falls back to built-in themes
			 * - Invalid theme ID: Returns validation error with available themes
			 */
			validate: async (value, _context) => {
				try {
					const { config } = await getConfigWithCache()
					const availableThemeIds = getAvailableThemes(config)
					const isValid = availableThemeIds.includes(value.trim().toLowerCase())

					return {
						valid: isValid,
						...(isValid
							? {}
							: { error: `Invalid theme. Available themes: ${availableThemeIds.join(", ")}` }),
					}
				} catch (_error) {
					// Fallback validation if config loading fails
					const builtinThemeIds = getBuiltinThemeIds()
					const isValid = builtinThemeIds.includes(value.trim().toLowerCase())

					return {
						valid: isValid,
						...(isValid ? {} : { error: `Invalid theme. Available themes: ${builtinThemeIds.join(", ")}` }),
					}
				}
			},
		},
	],
	handler: async (context) => {
		const { args, addMessage, setTheme } = context
		// Use cached config to avoid multiple loads
		const { config } = await getConfigWithCache()
		const availableThemeIds = getAvailableThemes(config)

		try {
			// If no theme provided, show available themes
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
