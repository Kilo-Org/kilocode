import * as vscode from "vscode"
import { CodeContext } from "../ContextGatherer"

interface AutocompleteStrategyPrompt {
	systemPrompt: string
	userPrompt: string
}

export interface AutocompleteStrategy {
	getCompletionPrompts: (
		document: vscode.TextDocument,
		position: vscode.Position,
		context: CodeContext,
	) => AutocompleteStrategyPrompt
	parseResponse: (response: string) => string
}
