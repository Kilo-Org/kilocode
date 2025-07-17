import * as vscode from "vscode"

export class GhostCodeLensProvider implements vscode.CodeLensProvider {
	// This emitter will be used to signal VS Code to refresh the CodeLenses
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event

	private activeSuggestionRange: vscode.Range | undefined

	constructor() {
		// Refresh lenses when the configuration changes
		vscode.workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire()
		})
	}

	// Method to be called by your extension to show/hide the lens
	public setSuggestionRange(range: vscode.Range | undefined) {
		this.activeSuggestionRange = range
		this._onDidChangeCodeLenses.fire()
	}

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
		if (this.activeSuggestionRange) {
			const accept = new vscode.CodeLens(this.activeSuggestionRange)
			accept.command = {
				title: "Accept (Tab)",
				command: "kilo-code.ghost.applyCurrentSuggestions",
				arguments: [],
			}
			const dismiss = new vscode.CodeLens(this.activeSuggestionRange)
			dismiss.command = {
				title: "Dismiss All (Esc)",
				command: "kilo-code.ghost.cancelSuggestions",
				arguments: [],
			}
			const next = new vscode.CodeLens(this.activeSuggestionRange)
			next.command = {
				title: "Next (↓)",
				command: "kilo-code.ghost.goToNextSuggestion",
				arguments: [],
			}
			const previous = new vscode.CodeLens(this.activeSuggestionRange)
			previous.command = {
				title: "Previous (↑)",
				command: "kilo-code.ghost.goToPreviousSuggestion",
				arguments: [],
			}
			return [accept, dismiss, next, previous]
		}
		return
	}
}
