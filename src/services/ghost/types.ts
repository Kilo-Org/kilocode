import * as vscode from "vscode"

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
}

export type GhostSuggestionEditOperationType = "+" | "-"

export interface GhostSuggestionEditOperation {
	type: GhostSuggestionEditOperationType
	fileUri: vscode.Uri
	line: number
	content: string
}
