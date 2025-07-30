import * as vscode from "vscode"

export interface DocumentStoreItem {
	lastAccessed: number
	[key: string]: any
}

export class DocumentStoreMemoryOptimizer {
	/**
	 * Get dynamic debounce time based on file size
	 */
	public static getDebounceTime(document: vscode.TextDocument): number {
		const contentLength = document.getText().length

		if (contentLength < 1000) return 200
		if (contentLength < 10000) return 500
		if (contentLength < 50000) return 1000
		return 2000
	}

	/**
	 * Check if AST parsing should be performed for a document
	 */
	public static shouldParseAST(document: vscode.TextDocument, maxFileSize: number, maxLineCount: number): boolean {
		const content = document.getText()
		if (content.length > maxFileSize) {
			console.warn(`Skipping AST parsing for large file: ${document.uri.fsPath} (${content.length} bytes)`)
			return false
		}

		const lineCount = document.lineCount
		if (lineCount > maxLineCount) {
			console.warn(`Skipping AST parsing for file with many lines: ${document.uri.fsPath} (${lineCount} lines)`)
			return false
		}

		return true
	}

	/**
	 * Enforce document limit using LRU eviction
	 */
	public static enforceLRULimit<T extends DocumentStoreItem>(
		store: Map<string, T>,
		maxDocuments: number,
		removeCallback: (uri: string) => void,
	): void {
		if (store.size <= maxDocuments) {
			return
		}

		const entries = Array.from(store.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
		const toRemove = entries.slice(0, store.size - maxDocuments)

		toRemove.forEach(([uri]) => {
			removeCallback(uri)
		})
	}
}
