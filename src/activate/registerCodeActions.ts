import * as vscode from "vscode"

import { CodeActionId, CodeActionName } from "@roo-code/types"

import { getCodeActionCommand } from "../utils/commands"
import { EditorUtils } from "../integrations/editor/EditorUtils"
import { ClineProvider } from "../core/webview/ClineProvider"

export const registerCodeActions = (context: vscode.ExtensionContext) => {
	registerCodeAction(context, "explainCode", "EXPLAIN")
	registerCodeAction(context, "fixCode", "FIX")
	registerCodeAction(context, "improveCode", "IMPROVE")
	registerCodeAction(context, "addToContext", "ADD_TO_CONTEXT")
	registerCodeAction(context, "addToKiloCode", "ADD_TO_KILO_CODE")

	// New commands for different contexts
	registerFilePathCommand(context)
	registerSelectedTextCommand(context)
	registerProblemCommand(context)
}

const registerCodeAction = (context: vscode.ExtensionContext, command: CodeActionId, promptType: CodeActionName) => {
	let userInput: string | undefined

	context.subscriptions.push(
		vscode.commands.registerCommand(getCodeActionCommand(command), async (...args: any[]) => {
			// Handle both code action and direct command cases.
			let filePath: string
			let selectedText: string
			let startLine: number | undefined
			let endLine: number | undefined
			let diagnostics: any[] | undefined

			if (args.length > 1) {
				// Called from code action.
				;[filePath, selectedText, startLine, endLine, diagnostics] = args
			} else {
				// Called directly from command palette.
				const context = EditorUtils.getEditorContext()

				if (!context) {
					return
				}

				;({ filePath, selectedText, startLine, endLine, diagnostics } = context)
			}

			const params = {
				...{ filePath, selectedText },
				...(startLine !== undefined ? { startLine: startLine.toString() } : {}),
				...(endLine !== undefined ? { endLine: endLine.toString() } : {}),
				...(diagnostics ? { diagnostics } : {}),
				...(userInput ? { userInput } : {}),
			}

			await ClineProvider.handleCodeAction(command, promptType, params)
		}),
	)
}

// Register command for adding file path to context (for explorer and file tabs)
const registerFilePathCommand = (context: vscode.ExtensionContext) => {
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.addFilePathToKiloCode", async (uri?: vscode.Uri) => {
			let filePath: string

			if (uri) {
				// Called from explorer context menu
				filePath = uri.fsPath
			} else {
				// Called from file tab or active editor
				const activeEditor = vscode.window.activeTextEditor
				if (!activeEditor) {
					return
				}
				filePath = activeEditor.document.uri.fsPath
			}

			const params = { filePath }
			await ClineProvider.handleCodeAction("addToKiloCode", "ADD_FILE_PATH_TO_KILO_CODE", params)
		}),
	)
}

// Register command for adding selected text to context (for debug console)
const registerSelectedTextCommand = (context: vscode.ExtensionContext) => {
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.addSelectedTextToKiloCode", async () => {
			const activeEditor = vscode.window.activeTextEditor
			if (!activeEditor) {
				return
			}

			const selection = activeEditor.selection
			const selectedText = activeEditor.document.getText(selection)

			if (!selectedText) {
				return
			}

			const params = {
				filePath: activeEditor.document.uri.fsPath,
				selectedText,
				startLine: (selection.start.line + 1).toString(),
				endLine: (selection.end.line + 1).toString(),
			}
			await ClineProvider.handleCodeAction("addToContext", "ADD_TO_CONTEXT", params)
		}),
	)
}

// Register command for adding problem info to context (for problems panel)
const registerProblemCommand = (context: vscode.ExtensionContext) => {
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.addProblemToKiloCode", async () => {
			const activeEditor = vscode.window.activeTextEditor
			if (!activeEditor) {
				return
			}

			const diagnostics = vscode.languages.getDiagnostics(activeEditor.document.uri)
			if (diagnostics.length === 0) {
				return
			}

			// Get the first diagnostic as an example, in real implementation
			// this should get the selected problem from the problems panel
			const diagnostic = diagnostics[0]
			const params = {
				filePath: activeEditor.document.uri.fsPath,
				selectedText: activeEditor.document.getText(diagnostic.range),
				startLine: (diagnostic.range.start.line + 1).toString(),
				endLine: (diagnostic.range.end.line + 1).toString(),
				diagnostics: [
					{
						message: diagnostic.message,
						severity: diagnostic.severity,
						source: diagnostic.source,
						code: diagnostic.code,
					},
				],
			}
			await ClineProvider.handleCodeAction("addToContext", "ADD_TO_CONTEXT", params)
		}),
	)
}
