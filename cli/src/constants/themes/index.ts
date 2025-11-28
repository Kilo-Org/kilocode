/**
 * Unified Theme System for Kilo Code CLI
 *
 * This module provides a centralized theme structure that consolidates
 * color usage across all UI components into semantic categories.
 *
 * @see THEME_PLAN.md for detailed design documentation
 */

import type { Theme, ThemeId } from "../../types/theme.js"
import type { CLIConfig } from "../../config/types.js"
import { alphaTheme } from "./alpha.js"
import { darkTheme } from "./dark.js"
import { lightTheme } from "./light.js"
import { draculaTheme } from "./dracula.js"
import { atomOneDarkTheme } from "./atom-one-dark.js"
import { ayuDarkTheme } from "./ayu-dark.js"
import { githubDarkTheme } from "./github-dark.js"
import { githubLightTheme } from "./github-light.js"
import { googleCodeTheme } from "./googlecode.js"
import { xcodeTheme } from "./xcode.js"
import { shadesOfPurpleTheme } from "./shades-of-purple.js"
import { ayuLightTheme } from "./ayu-light.js"
import { ansiTheme } from "./ansi.js"
import { ansiLightTheme } from "./ansi-light.js"

/**
 * Registry of all available themes
 */
const themeRegistry: Record<ThemeId, Theme> = {
	dark: darkTheme,
	light: lightTheme,
	alpha: alphaTheme,
	dracula: draculaTheme,
	"atom-one-dark": atomOneDarkTheme,
	"ayu-dark": ayuDarkTheme,
	"github-dark": githubDarkTheme,
	"github-light": githubLightTheme,
	googlecode: googleCodeTheme,
	xcode: xcodeTheme,
	"shades-of-purple": shadesOfPurpleTheme,
	"ayu-light": ayuLightTheme,
	ansi: ansiTheme,
	"ansi-light": ansiLightTheme,
}

/**
 * Get a theme by ID (supports custom themes from config)
 * @param themeId - The theme identifier
 * @param config - Optional config containing custom themes
 * @returns The requested theme, or dark theme as fallback
 */
export function getThemeById(themeId: ThemeId, config?: CLIConfig): Theme {
	// Check custom themes first if config is provided
	if (config && config.customThemes && config.customThemes[themeId]) {
		return config.customThemes[themeId]
	}

	// Fall back to built-in themes
	return themeRegistry[themeId] || darkTheme
}

/**
 * Get all available theme IDs
 * @param config - Optional config containing custom themes
 * @returns Array of theme identifiers sorted by type then alphabetically
 */
export function getAvailableThemes(config?: CLIConfig): ThemeId[] {
	const builtInThemes = Object.keys(themeRegistry) as ThemeId[]
	let allThemes: ThemeId[] = []

	if (config && config.customThemes) {
		const customThemeIds = Object.keys(config.customThemes) as ThemeId[]
		allThemes = [...builtInThemes, ...customThemeIds]
	} else {
		allThemes = builtInThemes
	}

	// Sort themes by type (Dark first, then Light, then Custom), then alphabetically
	const typeOrder = { Dark: 0, Light: 1, Custom: 2 }
	return allThemes.sort((a, b) => {
		const themeA = getThemeById(a, config)
		const themeB = getThemeById(b, config)
		const typeAOrder = typeOrder[themeA.type as keyof typeof typeOrder] ?? 3
		const typeBOrder = typeOrder[themeB.type as keyof typeof typeOrder] ?? 3

		if (typeAOrder !== typeBOrder) {
			return typeAOrder - typeBOrder
		}
		return a.localeCompare(b)
	})
}

/**
 * Check if a theme ID is valid
 * @param themeId - The theme identifier to check
 * @param config - Optional config containing custom themes
 * @returns True if the theme exists
 */
export function isValidThemeId(themeId: string, config?: CLIConfig): themeId is ThemeId {
	const builtInThemes = Object.keys(themeRegistry)
	const isValidBuiltIn = builtInThemes.includes(themeId)

	// Also check custom themes if config is provided
	if (config && config.customThemes) {
		return isValidBuiltIn || Object.keys(config.customThemes).includes(themeId)
	}

	return isValidBuiltIn
}

// Re-export types and themes
export type { Theme, ThemeId } from "../../types/theme.js"
export { darkTheme } from "./dark.js"
export { lightTheme } from "./light.js"
export { alphaTheme } from "./alpha.js"
export { draculaTheme } from "./dracula.js"
export { atomOneDarkTheme } from "./atom-one-dark.js"
export { ayuDarkTheme } from "./ayu-dark.js"
export { githubDarkTheme } from "./github-dark.js"
export { githubLightTheme } from "./github-light.js"
export { googleCodeTheme } from "./googlecode.js"
export { xcodeTheme } from "./xcode.js"
export { shadesOfPurpleTheme } from "./shades-of-purple.js"
export { ayuLightTheme } from "./ayu-light.js"
export { ansiTheme } from "./ansi.js"
export { ansiLightTheme } from "./ansi-light.js"
