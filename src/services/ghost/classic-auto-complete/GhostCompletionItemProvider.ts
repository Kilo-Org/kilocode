import * as vscode from "vscode"
import { findMatchingSuggestion } from "./GhostInlineCompletionProvider"
import { FillInAtCursorSuggestion } from "./GhostSuggestions"
import { extractPrefixSuffix } from "../types"

/**
 * Provides dropdown completion items that show multiple suggestions including attribution
 */
export class GhostCompletionItemProvider implements vscode.CompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []

	/**
	 * Update the suggestions history from the inline completion provider
	 */
	public updateSuggestions(suggestions: FillInAtCursorSuggestion[]): void {
		this.suggestionsHistory = suggestions
	}

	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		_context: vscode.CompletionContext,
	): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
		const { prefix, suffix } = extractPrefixSuffix(document, position)
		const matchingText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

		const items: vscode.CompletionItem[] = []

		// Only show dropdown if we have a cached suggestion
		if (matchingText !== null) {
			// Main code suggestion
			const codeSuggestion = new vscode.CompletionItem("Ghost Suggestion")
			codeSuggestion.kind = vscode.CompletionItemKind.Text
			codeSuggestion.insertText = matchingText
			codeSuggestion.detail = "AI-generated code suggestion"
			codeSuggestion.documentation = new vscode.MarkdownString("Code suggestion from Kilo Ghost")
			codeSuggestion.sortText = "0" // Sort first
			items.push(codeSuggestion)

			// Attribution comment
			const attribution = new vscode.CompletionItem("Attribution Comment")
			attribution.kind = vscode.CompletionItemKind.Text
			attribution.insertText = "// code coproduced by kilo\n"
			attribution.detail = "Add attribution comment"
			attribution.documentation = new vscode.MarkdownString(
				"Insert an attribution comment indicating code was co-produced by Kilo",
			)
			attribution.sortText = "1" // Sort second
			items.push(attribution)
		}

		return items
	}
}
