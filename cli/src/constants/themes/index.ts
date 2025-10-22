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
