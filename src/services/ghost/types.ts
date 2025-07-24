import * as vscode from "vscode"
import { Node } from "web-tree-sitter"

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
	ast?: ASTContext
	lastParsedVersion?: number
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

export interface ASTContext {
	rootNode: Node
	language: string
}

export interface GhostSuggestionContext {
	document?: vscode.TextDocument
	documentAST?: ASTContext
	editor?: vscode.TextEditor
	openFiles?: vscode.TextDocument[]
	range?: vscode.Range | vscode.Selection
	rangeASTNode?: Node
	userInput?: string
}
