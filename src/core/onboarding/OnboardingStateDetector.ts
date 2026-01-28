// kilocode_change - new file
import * as vscode from "vscode"
import { HistoryItem } from "@roo-code/types"

export class OnboardingStateDetector {
	constructor(private context: vscode.ExtensionContext) {}

	async detectWorkspaceState(): Promise<{
		hasOpenFolder: boolean
		hasSessionHistory: boolean
	}> {
		// Check if workspace has folders
		const folders = vscode.workspace.workspaceFolders
		const hasOpenFolder = folders !== undefined && folders.length > 0

		// Check if user has previous sessions for the current workspace
		const taskHistory = this.context.globalState.get<HistoryItem[]>("taskHistory") || []
		const currentWorkspace = folders?.[0]?.uri.fsPath
		const hasSessionHistory = currentWorkspace
			? taskHistory.some((item) => item.workspace === currentWorkspace)
			: false

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
