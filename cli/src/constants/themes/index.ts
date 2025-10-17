/**
 * Unified Theme System for Kilo Code CLI
 *
 * This module provides a centralized theme structure that consolidates
 * color usage across all UI components into semantic categories.
 *
 * @see THEME_PLAN.md for detailed design documentation
 */

import type { Theme, ThemeId } from "../../types/theme.js"
import { alphaTheme } from "./alpha.js"
import { darkTheme } from "./dark.js"
import { lightTheme } from "./light.js"

/**
 * Registry of all available themes
 */
const themeRegistry: Record<ThemeId, Theme> = {
	dark: darkTheme,
	light: lightTheme,
	alpha: alphaTheme,
}

/**
 * Get a theme by ID
 * @param themeId - The theme identifier
 * @returns The requested theme, or dark theme as fallback
 */
export function getThemeById(themeId: ThemeId): Theme {
	return themeRegistry[themeId] || darkTheme
}

/**
 * Get all available theme IDs
 * @returns Array of theme identifiers
 */
export function getAvailableThemes(): ThemeId[] {
	return Object.keys(themeRegistry)
}

/**
 * Check if a theme ID is valid
 * @param themeId - The theme identifier to check
 * @returns True if the theme exists
 */
export function isValidThemeId(themeId: string): themeId is ThemeId {
	return themeId in themeRegistry
}

// Re-export types and themes
export type { Theme, ThemeId } from "../../types/theme.js"
export { darkTheme } from "./dark.js"
export { lightTheme } from "./light.js"
export { alphaTheme } from "./alpha.js"
