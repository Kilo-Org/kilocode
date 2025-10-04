import * as vscode from "vscode"
import { GhostSuggestionContext } from "./types"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { createMercuryContext } from "./snippets/EditorContextBuilder"
import { getAllSnippets, convertSnippetsToMercuryFormat } from "./snippets/collector"
import { RecentlyEditedRange, GhostSnippetType, GhostCodeSnippet } from "./snippets/types"

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

	/**
	 * Add Mercury context using Continue's comprehensive snippet system
	 */
	private async addMercuryContext(context: GhostSuggestionContext): Promise<GhostSuggestionContext> {
		if (!context.document || !context.range) {
			return context
		}

		try {
			// Create token-aware context using Mercury Coder optimized settings
			const recentlyEditedRanges = this.collectRecentlyEditedRanges(context.document)
			const recentlyVisitedRanges = this.collectRecentlyVisitedRanges()

			const {
				context: editorContext,
				contextualText,
				editableRegion,
			} = createMercuryContext(context.document, context.range, recentlyEditedRanges, recentlyVisitedRanges)

			// Get all snippets using Continue's approach with new context
			const snippetPayload = await getAllSnippets(editorContext)

			// Enhanced context information is now available via editableRegion and contextualText
			// TODO: Consider extending GhostSuggestionContext interface to store token budget info

			// Convert to Mercury Coder format
			context.mercuryRecentlyViewedSnippets = convertSnippetsToMercuryFormat(snippetPayload)

			// Add edit history using Continue's approach
			context.mercuryEditHistory = this.collectEditHistoryFromDocumentStore(context.document)
		} catch (error) {
			console.warn("Failed to add Mercury context:", error)
		}

		return context
	}

	/**
	 * Collect recently edited ranges from document store
	 */
	private collectRecentlyEditedRanges(document: vscode.TextDocument): RecentlyEditedRange[] {
		const storeItem = this.documentStore.getDocument(document.uri)
		if (!storeItem || !storeItem.recentActions) {
			return []
		}

		// Convert recent actions to RecentlyEditedRange format
		return storeItem.recentActions
			.filter((action) => action.lineRange && action.content)
			.slice(0, 5) // Last 5 edited ranges
			.map((action) => ({
				filepath: document.uri.fsPath,
				timestamp: action.timestamp || Date.now(),
				lines: action.content?.split("\n") || [],
				symbols: new Set([action.affectedSymbol].filter(Boolean) as string[]),
			}))
	}

	/**
	 * Collect recently visited ranges (simplified)
	 */
	private collectRecentlyVisitedRanges() {
		// Get recently opened files as visited ranges
		const openFiles = vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme === "file").slice(0, 3)

		return openFiles.map((doc) => ({
			filepath: doc.uri.fsPath,
			content: doc.getText().split("\n").slice(0, 10).join("\n"), // First 10 lines
			type: GhostSnippetType.Code,
		})) as GhostCodeSnippet[]
	}

	/**
	 * Collect edit history using Continue's diff format approach
	 */
	private collectEditHistoryFromDocumentStore(document: vscode.TextDocument): string[] {
		const storeItem = this.documentStore.getDocument(document.uri)
		if (!storeItem || !storeItem.history) {
			return []
		}

		// Process history entries like Continue does - remove index lines and separators
		return storeItem.history
			.slice(0, 3) // Last 3 history entries
			.map((diff) => {
				// If it's a diff format, process like Continue does
				if (diff.includes("@@")) {
					return diff.split("\n").slice(2).join("\n")
				}
				return diff
			})
			.filter((diff) => diff.trim().length > 0)
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
		context = await this.addMercuryContext(context)
		return context
	}
}
