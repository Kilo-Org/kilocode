import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"

export class GhostCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = {
		quickfix: vscode.CodeActionKind.QuickFix,
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		GhostProvider.getDocumentStore().storeDocument(document)

		const action = new vscode.CodeAction(
			"Kilo Code - Ghost Writter",
			GhostCodeActionProvider.providedCodeActionKinds["quickfix"],
		)

		action.command = {
			command: "DUMMY_COMMAND_ID",
			title: "DUMMY_COMMAND_TITLE",
			arguments: [document.uri, range],
		}

		return [action]
	}

	public async resolveCodeAction(
		codeAction: vscode.CodeAction,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeAction> {
		if (token.isCancellationRequested) {
			return codeAction
		}

		// Retrieve the document and range we stored earlier
		const [uri, range] = codeAction.command!.arguments as [vscode.Uri, vscode.Range]
		const document = await vscode.workspace.openTextDocument(uri)

		GhostProvider.getDocumentStore().storeDocument(document)

		const suggestions = await GhostProvider.provideCodeSuggestions(document, range)

		if (suggestions === null) {
			vscode.window.showErrorMessage("No suggestions available from Ghost.")
			return codeAction
		}

		codeAction.edit = suggestions
		return codeAction

		// // Show a progress indicator
		// await vscode.window.withProgress(
		// 	{
		// 		location: vscode.ProgressLocation.Notification,
		// 		title: "🤖 Getting suggestion from Gemini...",
		// 		cancellable: true,
		// 	},
		// 	async (progress, progressToken) => {
		// 		progressToken.onCancellationRequested(() => {
		// 			console.log("User canceled the Gemini suggestion request.")
		// 		})

		// 		// Call the Gemini API
		// 		//const suggestedCode = await getGeminiSuggestion(selectedText);
		// 		const suggestedCode = "await newCodeHere();"

		// 		if (suggestedCode && suggestedCode !== selectedText && !progressToken.isCancellationRequested) {
		// 			// Create a WorkspaceEdit to replace the selected text with the suggestion
		// 			const workspaceEdit = new vscode.WorkspaceEdit()
		// 			workspaceEdit.replace(document.uri, range, suggestedCode)
		// 			workspaceEdit.insert(document.uri, new vscode.Position(range.end.line, range.end.character), "\n")
		// 			workspaceEdit.insert(
		// 				document.uri,
		// 				new vscode.Position(range.end.line, range.end.character),
		// 				suggestedCode,
		// 			)

		// 			codeAction.edit = workspaceEdit
		// 		} else if (!suggestedCode || suggestedCode === selectedText) {
		// 			vscode.window.showInformationMessage("Gemini did not provide a different suggestion.")
		// 		}
		// 	},
		// )
	}
}
