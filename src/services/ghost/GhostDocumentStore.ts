import * as vscode from "vscode"
import { GhostDocumentStoreItem } from "./types"

export class GhostDocumentStore {
	private historyLimit: number = 100 // Limit the number of snapshots to keep
	private documentStore: Map<string, GhostDocumentStoreItem> = new Map()

	public storeDocument(document: vscode.TextDocument): void {
		const uri = document.uri.toString()
		if (!this.documentStore.has(uri)) {
			this.documentStore.set(uri, {
				uri,
				document,
				history: [],
			})
		}
		const item = this.documentStore.get(uri)!
		item.history.push(document.getText())
		if (item.history.length > this.historyLimit) {
			item.history.shift() // Remove the oldest snapshot if we exceed the limit
		}
	}
}
