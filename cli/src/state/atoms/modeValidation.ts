/**
 * Mode validation atoms for Kilocode provider
 * Validates mode availability when custom modes are updated
 */

import { atom } from "jotai"
import { validateModeAvailability, getFallbackMode } from "../../services/kilocode/modeValidation.js"
import { customModesAtom } from "./extension.js"
import { modeAtom, providerAtom, setModeAtom } from "./config.js"
import { addMessageAtom } from "./ui.js"
import { logs } from "../../services/logs.js"
import type { CliMessage } from "../../types/cli.js"
import { generateModeFallbackMessage } from "../../ui/utils/messages.js"

/**
 * Effect atom to validate mode when custom modes are updated
 * This runs automatically when customModes change
 */
export const validateModeOnCustomModesUpdateAtom = atom(null, async (get, set) => {
	const customModes = get(customModesAtom)
	const currentMode = get(modeAtom)
	const currentProvider = get(providerAtom)

	// Only validate for Kilocode provider
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		return
	}

	// Check if current mode is available
	if (validateModeAvailability(currentMode, customModes)) {
		logs.debug(`Mode ${currentMode} is valid for current organization`, "modeValidation")
		return
	}

	// Mode not available - need fallback
	logs.warn(`Mode ${currentMode} not available for current organization`, "modeValidation")

	const fallbackMode = getFallbackMode()

	// Update to fallback mode
	await set(setModeAtom, fallbackMode)

	// Get organization name for message
	const orgName = currentProvider.kilocodeOrganizationId ? "this organization" : "Personal"
	const cliMessage: CliMessage = generateModeFallbackMessage({
		previousMode: currentMode,
		newMode: fallbackMode,
		organizationName: orgName,
	})

	set(addMessageAtom, cliMessage)

	logs.info(`Mode switched to fallback: ${fallbackMode}`, "modeValidation")
})
