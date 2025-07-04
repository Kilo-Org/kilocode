import * as vscode from "vscode"

/**
 * Creates an inline completion item with tracking command
 * @param completionText The text to be inserted as completion
 * @param insertRange The range where the completion should be inserted
 * @param position The position in the document
 * @returns A configured vscode.InlineCompletionItem
 */
export const createInlineCompletionItem = (
	completionText: string,
	insertRange: vscode.Range,
): vscode.InlineCompletionItem => {
	return Object.assign(new vscode.InlineCompletionItem(completionText, insertRange), {
		command: {
			command: "kilo-code.trackAcceptedSuggestion",
			title: "Track Accepted Suggestion",
			arguments: [completionText],
		},
	})
}
