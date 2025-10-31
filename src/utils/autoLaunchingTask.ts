// kilocode_change - new file Support JSON-based launch configurations
import * as vscode from "vscode"

interface LaunchConfig {
	prompt: string
	profile?: string
	mode?: string
}

/**
 * Checks for launch configuration and runs the task immediately if found.
 * Reads .kilocode/launchConfig.json from the workspace root.
 */
export async function checkAndRunAutoLaunchingTask(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return
	}

	const workspaceFolderUri = vscode.workspace.workspaceFolders[0].uri
	const configPath = vscode.Uri.joinPath(workspaceFolderUri, ".kilocode", "launchConfig.json")

	try {
		const configContent = await vscode.workspace.fs.readFile(configPath)
		const configText = Buffer.from(configContent).toString("utf8")
		const config = JSON.parse(configText) as LaunchConfig
		console.log(`🚀 Auto-launching task from '${configPath}' with config:\n${JSON.stringify(config)}`)

		await new Promise((resolve) => setTimeout(resolve, 500))
		await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")

		vscode.commands.executeCommand("kilo-code.newTask", config) // Pass the full config to newTask
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
			return // No config file found
		}
		console.error(`Error reading launch config:`, error)
	}
}
