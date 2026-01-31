import type { ModeConfig } from "../../types/messages.js"
import { DEFAULT_MODES as DEFAULT_MODES_KILO, DEFAULT_MODE_SLUG as DEFAULT_MODE_SLUG_KILO } from "@roo-code/types"

/**
 * Default mode
 */
export const DEFAULT_MODES = DEFAULT_MODES_KILO
export const DEFAULT_MODE_SLUG = DEFAULT_MODE_SLUG_KILO

/**
 * Get mode configuration by slug
 * @param slug - Mode slug
 * @param customModes - Array of custom modes
 * @returns Mode configuration or undefined
 */
export const getModeBySlug = (slug: string, customModes: ModeConfig[] = []): ModeConfig | undefined => {
	const allModes = [...DEFAULT_MODES, ...customModes]
	return allModes.find((mode) => mode.slug === slug)
}

/**
 * Get all available modes, with custom modes overriding built-in modes
 * @param customModes - Array of custom modes
 * @returns Array of all mode configurations
 */
export const getAllModes = (customModes: ModeConfig[] = []): ModeConfig[] => {
	if (!customModes?.length) {
		return [...DEFAULT_MODES]
	}

	const allModes = [...DEFAULT_MODES]

	customModes.forEach((customMode) => {
		const index = allModes.findIndex((mode) => mode.slug === customMode.slug)
		if (index !== -1) {
			allModes[index] = customMode
		} else {
			allModes.push(customMode)
		}
	})

	return allModes
}

/**
 * Create mode items for selection components
 * @param modes - Array of mode configurations
 * @returns Array of mode items with label and value
 */
export const createModeItems = (modes: ModeConfig[]) => {
	return modes.map((mode) => ({
		label: `${mode.name} - ${mode.description || "No description"}`,
		value: mode.slug,
	}))
}
