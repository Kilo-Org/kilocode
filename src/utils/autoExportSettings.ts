import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import fs from "fs/promises"

import { Package } from "../shared/package"
import { safeWriteJson } from "./safeWriteJson"
import { ProviderSettingsManager } from "../core/config/ProviderSettingsManager"
import { ContextProxy } from "../core/config/ContextProxy"

/**
 * Automatically exports RooCode settings to the specified path if configured.
 * This function is called after settings are updated to keep the auto-import file in sync.
 */
export async function autoExportSettings(
	providerSettingsManager: ProviderSettingsManager,
	contextProxy: ContextProxy,
	outputChannel?: vscode.OutputChannel,
): Promise<void> {
	try {
		// Get the auto-import settings path from VSCode settings
		const settingsPath = vscode.workspace.getConfiguration(Package.name).get<string>("autoImportSettingsPath")

		if (!settingsPath || settingsPath.trim() === "") {
			// No auto-export path configured
			return
		}

		// Resolve the path (handle ~ for home directory and relative paths)
		const resolvedPath = resolvePath(settingsPath.trim())

		if (outputChannel) {
			outputChannel.appendLine(`[AutoExport] Exporting settings to: ${resolvedPath}`)
		}

		// Export the current settings
		const providerProfiles = await providerSettingsManager.export()
		const globalSettings = await contextProxy.export()

		// It's okay if there are no global settings, but if there are no
		// provider profiles configured then don't export
		if (typeof providerProfiles === "undefined") {
			if (outputChannel) {
				outputChannel.appendLine(`[AutoExport] No provider profiles to export`)
			}
			return
		}

		// Ensure the directory exists
		const dirname = path.dirname(resolvedPath)
		await fs.mkdir(dirname, { recursive: true })

		// Write the settings to the file
		await safeWriteJson(resolvedPath, { providerProfiles, globalSettings })

		if (outputChannel) {
			outputChannel.appendLine(`[AutoExport] Successfully exported settings to ${resolvedPath}`)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (outputChannel) {
			outputChannel.appendLine(`[AutoExport] Failed to export settings: ${errorMessage}`)
		}
		// Don't throw - this is a background operation
		console.warn("Auto-export settings error:", error)
	}
}

/**
 * Resolves a file path, handling home directory expansion and relative paths
 */
function resolvePath(settingsPath: string): string {
	// Handle home directory expansion
	if (settingsPath.startsWith("~/")) {
		return path.join(os.homedir(), settingsPath.slice(2))
	}

	// Handle absolute paths
	if (path.isAbsolute(settingsPath)) {
		return settingsPath
	}

	// Handle relative paths (relative to home directory for safety)
	return path.join(os.homedir(), settingsPath)
}
