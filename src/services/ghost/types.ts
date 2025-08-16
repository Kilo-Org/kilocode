import * as vscode from "vscode"
import { Node } from "web-tree-sitter"

/**
 * Represents the type of user action performed on a document
 */
export enum UserActionType {
	ADDITION = "ADDITION", // Added new code
	DELETION = "DELETION", // Removed existing code
	MODIFICATION = "MODIFICATION", // Changed existing code
	REFACTOR = "REFACTOR", // Renamed or moved code
	FORMAT = "FORMAT", // Changed formatting without semantic changes
}

/**
 * Represents a meaningful user action performed on a document
 */
export interface UserAction {
	type: UserActionType
	description: string
	lineRange?: {
		start: number
		end: number
	}
	affectedSymbol?: string // Function/variable/class name if applicable
	scope?: string // Function/class/namespace containing the change
	timestamp?: number // When the action occurred
	content?: string // The actual content that was added, deleted, or modified
}

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
	ast?: ASTContext
	lastParsedVersion?: number
	recentActions?: UserAction[]
}

export type GhostSuggestionEditOperationType = "+" | "-"

export interface GhostSuggestionEditOperation {
	type: GhostSuggestionEditOperationType
	line: number
	oldLine: number
	newLine: number
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
	document: vscode.TextDocument
	documentAST?: ASTContext
	editor?: vscode.TextEditor
	openFiles?: vscode.TextDocument[]
	range?: vscode.Range | vscode.Selection
	rangeASTNode?: Node
	userInput?: string
	recentOperations?: UserAction[] // Stores meaningful user actions instead of raw diff
	diagnostics?: vscode.Diagnostic[] // Document diagnostics (errors, warnings, etc.)
}
