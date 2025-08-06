import * as vscode from "vscode"
import { GhostSuggestionContext } from "./types"
import { GhostDocumentStore } from "./GhostDocumentStore"

export class GhostContext {
	private documentStore: GhostDocumentStore

	constructor(documentStore: GhostDocumentStore) {
		this.documentStore = documentStore
	}

	private addRecentOperations(context: GhostSuggestionContext): GhostSuggestionContext {
		if (!context.document) {
			return context
		}
		const recentOperations = this.documentStore.getRecentOperations(context.document)
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
			await this.documentStore.storeDocument({
				document: context.document,
				parseAST: true,
				bypassDebounce: true,
			})
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

	private addDiagnostics(context: GhostSuggestionContext): GhostSuggestionContext {
		if (!context.document) {
			return context
		}
		const diagnostics = vscode.languages.getDiagnostics(context.document.uri)
		if (diagnostics && diagnostics.length > 0) {
			context.diagnostics = diagnostics
		}
		return context
	}

	public async generate(initialContext: GhostSuggestionContext): Promise<GhostSuggestionContext> {
		let context = initialContext
		context = this.addEditor(context)
		context = this.addOpenFiles(context)
		context = this.addRange(context)
		//context = await this.addAST(context)
		context = this.addRangeASTNode(context)
		context = this.addRecentOperations(context)
		context = this.addDiagnostics(context)
		return context
	}
}
