/**
 * Mode validation service for Kilocode provider
 * Validates mode availability against organization-specific mode lists
 */

import type { ModeConfig } from "../../types/messages.js"
import { DEFAULT_MODES } from "../../constants/modes/defaults.js"

/**
 * Default fallback mode when current mode is not available
 */
export const DEFAULT_FALLBACK_MODE = "code"

/**
 * Validate if a mode is available in the current mode list
 * @param modeSlug - The mode slug to validate
 * @param customModes - The organization's custom modes
 * @returns true if the mode is available, false otherwise
 */
export function validateModeAvailability(modeSlug: string, customModes: ModeConfig[]): boolean {
	const allModes = [...DEFAULT_MODES, ...customModes]
	return allModes.some((mode) => mode.slug === modeSlug)
}

/**
 * Get the fallback mode when current mode is not available
 * @returns The default fallback mode slug
 */
export function getFallbackMode(): string {
	return DEFAULT_FALLBACK_MODE
}

/**
 * Get fallback result with organization context
 * @param currentMode - The current mode that is not available
 * @param customModes - The available custom modes
 * @returns Object with fallback mode and whether fallback was needed
 */
export function getModeValidationResult(
	currentMode: string,
	customModes: ModeConfig[],
): {
	isValid: boolean
	fallbackMode: string | null
} {
	const isValid = validateModeAvailability(currentMode, customModes)

	if (isValid) {
		return { isValid: true, fallbackMode: null }
	}

	return {
		isValid: false,
		fallbackMode: getFallbackMode(),
	}
}
