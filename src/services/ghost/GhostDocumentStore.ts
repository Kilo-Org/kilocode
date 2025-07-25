import * as vscode from "vscode"
import * as path from "path"
import { createPatch } from "diff"
import { GhostDocumentStoreItem, ASTContext } from "./types"

export class GhostDocumentStore {
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private historyLimit: number = 20 // Limit the number of snapshots to keep
	private documentStore: Map<string, GhostDocumentStoreItem> = new Map()
	private parserInitialized: boolean = false

	/**
	 * Store a document in the document store and optionally parse its AST
	 * @param document The document to store
	 * @param parseAST Whether to parse the AST for this document
	 * @param bypassDebounce Whether to bypass the debounce mechanism and store immediately
	 */
	public async storeDocument({
		document,
		parseAST = true,
		bypassDebounce = false,
	}: {
		document: vscode.TextDocument
		parseAST?: boolean
		bypassDebounce?: boolean
	}): Promise<void> {
		const uri = document.uri.toString()
		const debounceWait = 500 // 500ms delay

		// Function to perform the actual document storage
		const performStorage = async () => {
			if (!this.documentStore.has(uri)) {
				this.documentStore.set(uri, {
					uri,
					document,
					history: [],
				})
			}

			const item = this.documentStore.get(uri)!
			item.document = document // Update the document reference
			item.history.push(document.getText())
			if (item.history.length > this.historyLimit) {
				item.history.shift() // Remove the oldest snapshot if we exceed the limit
			}

			// Parse the AST if requested and if the document version has changed.
			// Corrected conditional logic
			if (parseAST && (!item.lastParsedVersion || item.lastParsedVersion !== document.version)) {
				// Assuming parseDocumentAST is an async method in the same class.
				await this.parseDocumentAST(document)
			}

			// Once executed, remove the timer from the map.
			this.debounceTimers.delete(uri)
		}

		// If bypassDebounce is true, execute storage immediately
		if (bypassDebounce) {
			await performStorage()
			return
		}

		// Otherwise, use the debounce mechanism
		// Clear any existing timer for this specific document to reset the debounce period.
		if (this.debounceTimers.has(uri)) {
			clearTimeout(this.debounceTimers.get(uri)!)
		}

		// Set a new timer to execute the storage logic after the specified delay.
		const timer = setTimeout(performStorage, debounceWait)

		// Store the new timer ID, associating it with the document's URI.
		this.debounceTimers.set(uri, timer)
	}

	/**
	 * Parse the AST for a document and store it
	 * @param document The document to parse
	 */
	public async parseDocumentAST(document: vscode.TextDocument): Promise<void> {
		try {
			const uri = document.uri.toString()
			const item = this.documentStore.get(uri)

			if (!item) {
				return
			}

			// Initialize the parser if needed
			if (!this.parserInitialized) {
				const { Parser } = require("web-tree-sitter")
				await Parser.init()
				this.parserInitialized = true
			}

			// Get file extension to determine parser
			const filePath = document.uri.fsPath
			const ext = path.extname(filePath).substring(1).toLowerCase()

			// Load the appropriate language parser
			const { loadRequiredLanguageParsers } = require("../tree-sitter/languageParser")
			const languageParsers = await loadRequiredLanguageParsers([filePath])
			const { parser } = languageParsers[ext] || {}

			if (parser) {
				// Parse the document content into an AST
				const documentContent = document.getText()
				const tree = parser.parse(documentContent)

				if (tree) {
					// Store the AST in the document store
					item.ast = {
						rootNode: tree.rootNode,
						language: ext,
					}
					item.lastParsedVersion = document.version
				}
			}
		} catch (error) {
			console.error("Error parsing document with tree-sitter:", error)
			// Continue without AST if there's an error
		}
	}

	/**
	 * Get the AST for a document
	 * @param documentUri The URI of the document
	 * @returns The AST context or undefined if not available
	 */
	public getAST(documentUri: vscode.Uri): ASTContext | undefined {
		const uri = documentUri.toString()
		const item = this.documentStore.get(uri)
		return item?.ast
	}

	/**
	 * Get a document from the store
	 * @param documentUri The URI of the document
	 * @returns The document store item or undefined if not found
	 */
	public getDocument(documentUri: vscode.Uri): GhostDocumentStoreItem | undefined {
		const uri = documentUri.toString()
		return this.documentStore.get(uri)
	}

	/**
	 * Check if a document needs its AST to be updated
	 * @param document The document to check
	 * @returns True if the AST needs to be updated
	 */
	public needsASTUpdate(document: vscode.TextDocument): boolean {
		const uri = document.uri.toString()
		const item = this.documentStore.get(uri)

		if (!item) {
			return true
		}

		return !item.ast || item.lastParsedVersion !== document.version
	}

	/**
	 * Clear the AST for a document to free up memory
	 * @param documentUri The URI of the document
	 */
	public clearAST(documentUri: vscode.Uri): void {
		const uri = documentUri.toString()
		const item = this.documentStore.get(uri)

		if (item) {
			item.ast = undefined
			item.lastParsedVersion = undefined
		}
	}

	/**
	 * Clear all ASTs from the document store to free up memory
	 */
	public clearAllASTs(): void {
		for (const item of this.documentStore.values()) {
			item.ast = undefined
			item.lastParsedVersion = undefined
		}
	}

	/**
	 * Get the last 10 operations performed by the user on a document
	 * @param document The document to get operations for
	 * @returns A diff string representing the last 10 operations
	 */
	public getRecentOperations(document: vscode.TextDocument): string {
		if (!document) {
			return ""
		}

		const uri = document.uri.toString()
		const item = this.getDocument(document.uri)

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
}
