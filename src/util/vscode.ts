import { workspace, ConfigurationTarget } from "vscode"

/**
 * Determines the appropriate configuration target for a given setting.
 *
 * It checks if a setting can be written to the WorkspaceFolder or Workspace level.
 * If it can, the corresponding target is returned. Otherwise, it defaults to the
 * Global target.
 *
 * @param settingId The ID of the setting to inspect (e.g., 'chat.tools.autoApprove').
 * @returns The appropriate ConfigurationTarget for the setting.
 */
export function getWritableConfigurationTarget(settingId: string): ConfigurationTarget {
	const inspect = workspace.getConfiguration().inspect(settingId)

	if (inspect?.workspaceFolderValue !== undefined) {
		return ConfigurationTarget.WorkspaceFolder
	}

	if (inspect?.workspaceValue !== undefined) {
		return ConfigurationTarget.Workspace
	}

	return ConfigurationTarget.Global
}
