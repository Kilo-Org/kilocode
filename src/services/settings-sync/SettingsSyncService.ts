import * as vscode from "vscode"
import { Package } from "../../shared/package"

/**
 * Service for managing Kilo Code settings synchronization with VS Code Settings Sync
 */
export class SettingsSyncService {
	// Keys from global state that should be synchronized
	// Note: API keys are stored in VS Code secrets storage and are already sync'd by VS Code
	private static readonly SYNC_KEYS = [
		"allowedCommands",
		"deniedCommands",
		"autoApprovalEnabled",
		"fuzzyMatchThreshold",
		"diffEnabled",
		"directoryContextAddedContext",
		"language",
		"customModes",
		"firstInstallCompleted",
		"telemetrySetting",
	] as const

	/**
	 * Initialize settings synchronization
	 * @param context VS Code extension context
	 */
	static async initialize(context: vscode.ExtensionContext): Promise<void> {
		const enableSync = vscode.workspace.getConfiguration(Package.name).get<boolean>("enableSettingsSync", true)

		if (enableSync) {
			// Register keys for synchronization with VS Code Settings Sync
			const syncKeys = this.SYNC_KEYS.map((key) => `${Package.name}.${key}`)
			context.globalState.setKeysForSync(syncKeys)

			console.log(`[SettingsSyncService] Registered ${syncKeys.length} keys for synchronization:`, syncKeys)
		} else {
			// Clear sync keys if sync is disabled
			context.globalState.setKeysForSync([])
			console.log(`[SettingsSyncService] Settings sync disabled - cleared sync keys`)
		}
	}

	/**
	 * Update sync registration when the setting changes
	 * @param context VS Code extension context
	 */
	static async updateSyncRegistration(context: vscode.ExtensionContext): Promise<void> {
		await this.initialize(context)
	}

	/**
	 * Get the list of keys that are registered for sync
	 */
	static getSyncKeys(): readonly string[] {
		return this.SYNC_KEYS.map((key) => `${Package.name}.${key}`)
	}
}
