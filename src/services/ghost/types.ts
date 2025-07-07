import * as vscode from "vscode"

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
}
