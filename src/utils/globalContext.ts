import { ExtensionContext } from "vscode"
import { getSettingsDirectoryPath } from "./storage"

export async function ensureSettingsDirectoryExists(context: ExtensionContext): Promise<string> {
	// getSettingsDirectoryPath already handles the custom storage path setting
	return await getSettingsDirectoryPath(context.globalStorageUri.fsPath)
}
