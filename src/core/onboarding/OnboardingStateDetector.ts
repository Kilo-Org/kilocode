import * as vscode from "vscode"

export class OnboardingStateDetector {
	constructor(private context: vscode.ExtensionContext) {}

	async detectWorkspaceState(): Promise<{
		hasOpenFolder: boolean
		hasSessionHistory: boolean
	}> {
		// Check if workspace has folders
		const folders = vscode.workspace.workspaceFolders
		const hasOpenFolder = folders !== undefined && folders.length > 0

		// Check if user has previous sessions
		const taskHistory = this.context.globalState.get<string[]>("taskHistory") || []
		const hasSessionHistory = taskHistory.length > 0

		return { hasOpenFolder, hasSessionHistory }
	}

	async detectEditorState(): Promise<{
		hasOpenFile: boolean
		hasSelectedCode: boolean
	}> {
		const activeEditor = vscode.window.activeTextEditor
		const hasOpenFile = activeEditor !== undefined
		const hasSelectedCode = activeEditor !== undefined && !activeEditor.selection.isEmpty

		return { hasOpenFile, hasSelectedCode }
	}
}
