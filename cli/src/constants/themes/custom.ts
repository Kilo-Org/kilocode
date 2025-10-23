/**
 * Custom theme management utilities
 */

import type { Theme } from "../../types/theme.js"
import type { CLIConfig } from "../../config/types.js"

/**
 * Get all themes including custom ones from config
 */
export function getAllThemes(config: CLIConfig): Record<string, Theme> {
	const builtInThemes = {
		// These will be imported from the main theme registry
		// We'll update this after modifying the registry
	}

	// Merge custom themes
	const customThemes = config.customThemes || {}

	return { ...builtInThemes, ...customThemes }
}

/**
 * Check if a theme is a custom theme
 */
export function isCustomTheme(themeId: string, config: CLIConfig): boolean {
	return !!(config.customThemes && config.customThemes[themeId])
}

/**
 * Add a custom theme to the configuration
 */
export function addCustomTheme(config: CLIConfig, themeId: string, theme: Theme): CLIConfig {
	if (!config.customThemes) {
		config.customThemes = {}
	}

	return {
		...config,
		customThemes: {
			...config.customThemes,
			[themeId]: {
				...theme,
				id: themeId, // Ensure the ID matches the key
			},
		},
	}
}

/**
 * Remove a custom theme from the configuration
 */
export function removeCustomTheme(config: CLIConfig, themeId: string): CLIConfig {
	if (!config.customThemes || !config.customThemes[themeId]) {
		return config
	}

	const { [themeId]: removed, ...remainingThemes } = config.customThemes

	return {
		...config,
		customThemes: remainingThemes,
	}
}

/**
 * Update a custom theme in the configuration
 */
export function updateCustomTheme(config: CLIConfig, themeId: string, theme: Partial<Theme>): CLIConfig {
	if (!config.customThemes || !config.customThemes[themeId]) {
		return config
	}

	return {
		...config,
		customThemes: {
			...config.customThemes,
			[themeId]: {
				...config.customThemes[themeId],
				...theme,
				id: themeId, // Ensure the ID is preserved
			},
		},
	}
}

/**
 * Get all built-in theme IDs
 */
export function getBuiltinThemeIds(): string[] {
	return [
		"dark",
		"light",
		"alpha",
		"ansi",
		"ansi-light",
		"atom-one-dark",
		"ayu-dark",
		"ayu-light",
		"dracula",
		"github-dark",
		"github-light",
		"googlecode",
		"shades-of-purple",
		"xcode",
	]
}

/**
 * Check if a theme is a built-in theme
 */
export function isBuiltinTheme(themeId: string): boolean {
	return getBuiltinThemeIds().includes(themeId)
}
