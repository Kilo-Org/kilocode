/**
 * Config synchronization atoms
 * Handles syncing CLI configuration to the extension
 *
 * This module is separate to avoid circular dependencies between config.ts and effects.ts
 */

import { atom } from "jotai"
import { extensionServiceAtom } from "./service.js"
import { mappedExtensionStateAtom } from "./config.js"
import { logs } from "../../services/logs.js"

/**
 * Effect atom to sync CLI configuration to the extension
 * This sends configuration updates to the extension when config changes
 */
export const syncConfigToExtensionEffectAtom = atom(null, async (get) => {
	const service = get(extensionServiceAtom)

	if (!service || !service.isReady()) {
		logs.debug("Service not ready, skipping config sync", "config-sync")
		return
	}

	try {
		const mappedState = get(mappedExtensionStateAtom)

		if (!mappedState.apiConfiguration) {
			logs.debug("No API configuration to sync", "config-sync")
			return
		}

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
