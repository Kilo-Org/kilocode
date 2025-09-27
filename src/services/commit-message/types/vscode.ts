import * as vscode from "vscode"

/**
 * VSCode Git repository interface for internal VSCode usage.
 * This represents the structure expected by VSCode's Git extension
 * when working with repository objects.
 */
export interface VscGenerationRequest {
	/** The Git extension input box where commit messages are displayed */
	inputBox: { value: string }

	/** Optional URI for the workspace root, used to determine target repository */
	rootUri?: vscode.Uri
}

/**
 * VSCode-specific message type mapping.
 */
export const VSCodeMessageTypeMap = {
	info: "showInformationMessage",
	error: "showErrorMessage",
	warning: "showWarningMessage",
} as const
