/**
 * Document History Tracker
 * Based on Continue's DocumentHistoryTracker.ts for AST and content history management
 * Adapted for VSCode integration without web-tree-sitter dependency
 */

/**
 * Simplified document history tracking without AST dependencies
 * Focuses on content history which is essential for Mercury Coder
 */
export class DocumentHistoryTracker {
	private static instance: DocumentHistoryTracker | null = null

	// Map from document path to content history (LIFO stack where newest is at front)
	private documentContentHistoryMap: Map<string, string[]>
	// Map from document path to diff history
	private documentDiffHistoryMap: Map<string, string[]>

	private constructor() {
		this.documentContentHistoryMap = new Map<string, string[]>()
		this.documentDiffHistoryMap = new Map<string, string[]>()
	}

	/**
	 * Get the singleton instance of DocumentHistoryTracker
	 */
	public static getInstance(): DocumentHistoryTracker {
		if (!DocumentHistoryTracker.instance) {
			DocumentHistoryTracker.instance = new DocumentHistoryTracker()
		}
		return DocumentHistoryTracker.instance
	}

	/**
	 * Add a document and its first state to the tracker
	 */
	public addDocument(documentPath: string, documentContent: string): void {
		this.documentContentHistoryMap.set(documentPath, [documentContent])
		this.documentDiffHistoryMap.set(documentPath, [])
	}

	/**
	 * Push a new content state to an existing document's history stack
	 */
	public push(documentPath: string, documentContent: string, diff?: string): void {
		const documentHistory = this.documentContentHistoryMap.get(documentPath)
		const diffHistory = this.documentDiffHistoryMap.get(documentPath)

		if (!documentHistory || !diffHistory) {
			console.error(`Document ${documentPath} not found in history tracker`)
			this.addDocument(documentPath, documentContent)
			return
		}

		// Add new content to front (most recent)
		documentHistory.unshift(documentContent)

		// Add diff if provided
		if (diff && diff.trim().length > 0) {
			diffHistory.unshift(diff)
		}

		// Limit history size to prevent memory issues
		const maxHistorySize = 10
		if (documentHistory.length > maxHistorySize) {
			documentHistory.splice(maxHistorySize)
		}
		if (diffHistory.length > maxHistorySize) {
			diffHistory.splice(maxHistorySize)
		}
	}

	/**
	 * Get the most recent content of a document
	 */
	public getMostRecentDocumentHistory(documentPath: string): string | null {
		const documentHistory = this.documentContentHistoryMap.get(documentPath)

		if (!documentHistory) {
			console.error(`Document ${documentPath} not found in history tracker`)
			return null
		}
		if (documentHistory.length === 0) {
			console.error(`Document ${documentPath} has no history`)
			return null
		}

		// Return the first element (most recent content)
		return documentHistory[0]
	}

	/**
	 * Get recent diff history for a document
	 */
	public getRecentDiffs(documentPath: string, limit: number = 3): string[] {
		const diffHistory = this.documentDiffHistoryMap.get(documentPath)
		if (!diffHistory) {
			return []
		}
		return diffHistory.slice(0, limit)
	}

	/**
	 * Get all content history for a document
	 */
	public getContentHistory(documentPath: string, limit: number = 5): string[] {
		const documentHistory = this.documentContentHistoryMap.get(documentPath)
		if (!documentHistory) {
			return []
		}
		return documentHistory.slice(0, limit)
	}

	/**
	 * Check if document exists in tracker
	 */
	public hasDocument(documentPath: string): boolean {
		return this.documentContentHistoryMap.has(documentPath)
	}

	/**
	 * Delete a document from the tracker
	 */
	public deleteDocument(documentPath: string): void {
		this.documentContentHistoryMap.delete(documentPath)
		this.documentDiffHistoryMap.delete(documentPath)
	}

	/**
	 * Clear all documents from the tracker
	 */
	public clearMap(): void {
		this.documentContentHistoryMap.clear()
		this.documentDiffHistoryMap.clear()
	}

	/**
	 * Get statistics about tracked documents
	 */
	public getStats(): {
		documentCount: number
		totalContentEntries: number
		totalDiffEntries: number
	} {
		let totalContentEntries = 0
		let totalDiffEntries = 0

		for (const [_, contentHistory] of this.documentContentHistoryMap) {
			totalContentEntries += contentHistory.length
		}

		for (const [_, diffHistory] of this.documentDiffHistoryMap) {
			totalDiffEntries += diffHistory.length
		}

		return {
			documentCount: this.documentContentHistoryMap.size,
			totalContentEntries,
			totalDiffEntries,
		}
	}
}
