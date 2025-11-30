// kilocode_change - new file
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
	static async initialize(context: vscode.ExtensionContext, outputChannel?: vscode.OutputChannel): Promise<void> {
		const enableSync = vscode.workspace.getConfiguration(Package.name).get<boolean>("enableSettingsSync", true)

		if (enableSync) {
			// Register keys for synchronization with VS Code Settings Sync
			const syncKeys = this.SYNC_KEYS.map((key) => `${Package.name}.${key}`)
			context.globalState.setKeysForSync(syncKeys)

			outputChannel?.appendLine(
				`[SettingsSyncService] Registered ${syncKeys.length} keys for synchronization: ${syncKeys.join(", ")}`,
			)
		} else {
			// Clear sync keys if sync is disabled
			context.globalState.setKeysForSync([])
			outputChannel?.appendLine(`[SettingsSyncService] Settings sync disabled - cleared sync keys`)
		}
	}

	/**
	 * Update sync registration when the setting changes
	 * @param context VS Code extension context
	 * @param outputChannel Optional VS Code output channel for logging
	 */
	static async updateSyncRegistration(
		context: vscode.ExtensionContext,
		outputChannel?: vscode.OutputChannel,
	): Promise<void> {
		await this.initialize(context, outputChannel)
	}

	/**
	 * Get the list of keys that are registered for sync
	 */
	static getSyncKeys(): readonly string[] {
		return this.SYNC_KEYS.map((key) => `${Package.name}.${key}`)
	}
}
