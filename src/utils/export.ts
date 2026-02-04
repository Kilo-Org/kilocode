import * as vscode from "vscode"
import * as path from "path"

export interface ExportContext {
	getValue(key: string): any
	setValue(key: string, value: any): Promise<void>
}

export interface ExportOptions {
	/**
	 * Whether to consider the active workspace folder as a default location.
	 * Default: true
	 */
	useWorkspace?: boolean
	/**
	 * Fallback directory if no previous path or workspace is available.
	 */
	fallbackDir?: string
}

/**
 * Resolves the default save URI for an export operation.
 * Priorities:
 * 1. Last used export path (if available)
 * 2. Active workspace folder (if useWorkspace is true)
 * 3. Fallback directory (e.g. Downloads or Documents)
 * 4. Default to just the filename (user's home/cwd)
 */
export function resolveDefaultSaveUri(
	context: ExportContext,
	configKey: string,
	fileName: string,
	options: ExportOptions = {},
): vscode.Uri {
	const { useWorkspace = true, fallbackDir } = options
	const lastExportPath = context.getValue(configKey) as string | undefined

	if (lastExportPath) {
		// Use the directory from the last export
		const lastDir = path.dirname(lastExportPath)
		return vscode.Uri.file(path.join(lastDir, fileName))
	} else {
		// Try workspace if enabled
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (useWorkspace && workspaceFolders && workspaceFolders.length > 0) {
			return vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, fileName))
		}

		// Fallback
		if (fallbackDir) {
			return vscode.Uri.file(path.join(fallbackDir, fileName))
		}

		// Default to cwd/home
		return vscode.Uri.file(fileName)
	}
}

export async function saveLastExportPath(context: ExportContext, configKey: string, uri: vscode.Uri) {
	await context.setValue(configKey, uri.fsPath)
}
