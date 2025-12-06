/**
 * Config synchronization atoms
 * Handles syncing CLI configuration to the extension
 *
 * This module is separate to avoid circular dependencies between config.ts and effects.ts
 */

import { atom } from "jotai"
import { extensionServiceAtom } from "./service.js"
import { mappedExtensionStateAtom } from "./config.js"
import {
	apiConfigurationAtom,
	extensionModeAtom,
	apiConfigurationLastLocalUpdateAtom,
	extensionModeLastLocalUpdateAtom,
} from "./extension.js"
import { logs } from "../../services/logs.js"

/**
 * Effect atom to sync CLI configuration to the extension
 * This sends configuration updates to the extension when config changes
 * Also updates local UI atoms to reflect the change immediately
 */
export const syncConfigToExtensionEffectAtom = atom(null, async (get, set) => {
	const service = get(extensionServiceAtom)

	// Get mapped state first (needed for both local update and extension sync)
	const mappedState = get(mappedExtensionStateAtom)

	if (!mappedState.apiConfiguration) {
		logs.debug("No API configuration to sync", "config-sync")
		return
	}

	// Update local UI atoms immediately so StatusBar reflects the change
	// Also set protection timestamps to prevent stale extension state from overwriting
	const now = Date.now()
	set(apiConfigurationAtom, mappedState.apiConfiguration)
	set(apiConfigurationLastLocalUpdateAtom, now)
	if (mappedState.mode) {
		set(extensionModeAtom, mappedState.mode)
		set(extensionModeLastLocalUpdateAtom, now)
	}

	logs.debug("Updated local UI atoms with new config and protection", "config-sync", {
		apiProvider: mappedState.apiConfiguration.apiProvider,
		protectionTimestamp: now,
	})

	// Sync to extension if service is ready
	if (!service || !service.isReady()) {
		logs.debug("Service not ready, skipping extension sync", "config-sync")
		return
	}

	try {
		logs.debug("Syncing config to extension", "config-sync", {
			apiProvider: mappedState.apiConfiguration.apiProvider,
			currentApiConfigName: mappedState.currentApiConfigName,
			mode: mappedState.mode,
			telemetry: mappedState.telemetrySetting,
		})

		// Delegate to ExtensionHost's shared sync method
		const extensionHost = service.getExtensionHost()
		await extensionHost.syncConfigurationMessages(mappedState)

		logs.info("Config synced to extension successfully", "config-sync")
	} catch (error) {
		logs.error("Failed to sync config to extension", "config-sync", { error })
	}
})
