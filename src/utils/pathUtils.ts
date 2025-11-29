import * as vscode from "vscode"
import * as path from "path"

/**
 * Checks if a file path is outside all workspace folders
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string): boolean {
	// If there are no workspace folders, consider everything outside workspace for safety
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	// Normalize and resolve the path to handle .. and . components correctly
	const absolutePath = path.resolve(filePath)

	// Check if the path is within any workspace folder
	return !vscode.workspace.workspaceFolders.some((folder) => {
		const folderPath = folder.uri.fsPath
		// Path is inside a workspace if it equals the workspace path or is a subfolder
		return absolutePath === folderPath || absolutePath.startsWith(folderPath + path.sep)
	})
}

// kilocode_change
/**
 * Parses parameters from an XML-like string by extracting content between matching tags.
 * This function searches for opening and closing tags (e.g., `<path>...</path>`) and extracts
 * the content between them for each specified parameter name.
 *
 * @param args The XML-like string containing parameter tags to extract
 * @param paramNames An array of parameter names to search for and extract
 * @returns A record mapping parameter names to their extracted values, or undefined if not found
 */
export function parseParamsFromArgs(
	args: string | undefined,
	paramNames: string[],
): Record<string, string | undefined> {
	const parsedParams: Record<string, string | undefined> = {}

	if (args) {
		for (const name of paramNames) {
			const tagOpen = `<${name}>`
			const tagClose = `</${name}>`

			const startIndex = args.indexOf(tagOpen)
			const endIndex = args.indexOf(tagClose)

			if (startIndex !== -1 && endIndex !== -1) {
				parsedParams[name] = args.substring(startIndex + tagOpen.length, endIndex)
			}
		}
	}

	return parsedParams
}
