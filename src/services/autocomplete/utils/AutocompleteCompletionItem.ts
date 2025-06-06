import * as vscode from "vscode"
import { Autocompletion } from "../types"

export const TRACK_ACCEPTED_SUGGESTION_COMMAND = "kilo-code.trackAcceptedSuggestion"

/**
 * Specialized InlineCompletionItem for autocomplete that includes tracking functionality
 */
export class AutocompleteCompletionItem extends vscode.InlineCompletionItem {
	constructor(completion: Autocompletion) {
		super(completion.text, completion.range)

		this.command = {
			command: TRACK_ACCEPTED_SUGGESTION_COMMAND,
			title: "Track Accepted Suggestion",
			arguments: [completion.text],
		}
	}
}
