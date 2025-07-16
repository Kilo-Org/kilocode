import * as vscode from "vscode"

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
}

export type GhostSuggestionEditOperationType = "+" | "-"

export interface GhostSuggestionEditOperation {
	type: GhostSuggestionEditOperationType
	line: number
	content: string
}

export interface GhostSuggestionEditOperationsOffset {
	added: number
	removed: number
	offset: number
}

export interface GhostSuggestionContext {
	userInput?: string
	document?: vscode.TextDocument
	range?: vscode.Range | vscode.Selection
	openFiles?: vscode.TextDocument[]
}
