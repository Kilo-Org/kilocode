import * as vscode from "vscode"
import { GhostSuggestionContext } from "./types"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { createPatch } from "diff"

export class GhostContext {
	private documentStore: GhostDocumentStore

	constructor(documentStore: GhostDocumentStore) {
		this.documentStore = documentStore
	}

	/**
	 * Get the last 10 operations performed by the user on a document
	 * @param document The document to get operations for
	 * @returns A diff string representing the last 10 operations
	 */
	private getRecentOperations(document: vscode.TextDocument): string {
		if (!document) {
			return ""
		}

		const uri = document.uri.toString()
		const item = this.documentStore.getDocument(document.uri)

		if (!item || item.history.length < 2) {
			return ""
		}

		// Get the last 10 versions (or fewer if not available)
		const historyLimit = 10
		const startIdx = Math.max(0, item.history.length - historyLimit)
		const recentHistory = item.history.slice(startIdx)

		// If we have at least 2 versions, compare the oldest with the newest
		if (recentHistory.length >= 2) {
			const oldContent = recentHistory[0]
			const newContent = recentHistory[recentHistory.length - 1]

			// Generate a diff between the oldest and newest versions
			const filePath = vscode.workspace.asRelativePath(document.uri)
			const diffPatch = createPatch(filePath, oldContent, newContent, "Previous version", "Current version")

			return diffPatch
		}

		return ""
	}

	/**
	 * Add recent user operations to the context
	 * @param context The context to add operations to
	 * @returns The updated context
	 */
	private addRecentOperations(context: GhostSuggestionContext): GhostSuggestionContext {
		if (!context.document) {
			return context
		}

		const recentOperations = this.getRecentOperations(context.document)
		if (recentOperations) {
			context.recentOperations = recentOperations
		}

		return context
	}

	private addEditor(context: GhostSuggestionContext): GhostSuggestionContext {
		const editor = vscode.window.activeTextEditor
		if (editor) {
			context.editor = editor
		}
		return context
	}

	private addOpenFiles(context: GhostSuggestionContext): GhostSuggestionContext {
		const openFiles = vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme === "file")
		context.openFiles = openFiles
		return context
	}

	private addRange(context: GhostSuggestionContext): GhostSuggestionContext {
		if (!context.range && context.editor) {
			context.range = context.editor.selection
		}
		return context
	}

	private async addAST(context: GhostSuggestionContext): Promise<GhostSuggestionContext> {
		if (!context.document) {
			return context
		}

		if (this.documentStore.needsASTUpdate(context.document)) {
			await this.documentStore.storeDocument(context.document, true)
		}
		context.documentAST = this.documentStore.getAST(context.document.uri)
		return context
	}

	private addRangeASTNode(context: GhostSuggestionContext): GhostSuggestionContext {
		if (!context.range || !context.documentAST) {
			return context
		}
		const startPosition = {
			row: context.range.start.line,
			column: context.range.start.character,
		}
		const endPosition = {
			row: context.range.end.line,
			column: context.range.end.character,
		}
		const nodeAtCursor = context.documentAST.rootNode.descendantForPosition(startPosition, endPosition)
		if (!nodeAtCursor) {
			return context
		}
		context.rangeASTNode = nodeAtCursor
		return context
	}

	public async generate(initialContext: GhostSuggestionContext): Promise<GhostSuggestionContext> {
		let context = initialContext
		context = this.addEditor(context)
		context = this.addOpenFiles(context)
		context = this.addRange(context)
		context = await this.addAST(context)
		context = this.addRangeASTNode(context)
		context = this.addRecentOperations(context)
		return context
	}
}
