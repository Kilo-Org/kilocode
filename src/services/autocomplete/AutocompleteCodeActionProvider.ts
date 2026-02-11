import * as vscode from "vscode"
import { t } from "../../i18n"

export class GhostCodeActionProvider implements vscode.CodeActionProvider {
	public readonly providedCodeActionKinds = {
		quickfix: vscode.CodeActionKind.QuickFix,
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		_context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		const action = new vscode.CodeAction(
			t("kilocode:ghost.codeAction.title"),
			this.providedCodeActionKinds["quickfix"],
		)
		action.command = {
			command: "kilo-code.ghost.generateSuggestions",
			title: "",
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
		return codeAction
	}
}
