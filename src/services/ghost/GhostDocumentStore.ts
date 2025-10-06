import * as vscode from "vscode"
import * as path from "path"
import { structuredPatch } from "diff"
import { GhostDocumentStoreItem, ASTContext, UserAction, UserActionType } from "./types"

export const GHOST_DOCUMENT_STORE_LIMITS = {
	MAX_DOCUMENTS: 50, // Limit the number of documents to keep
	MAX_HISTORY_PER_DOCUMENT: 50, // Limit the number of snapshots per document to keep
} as const

export class GhostDocumentStore {
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private historyLimit: number = 3 // Limit the number of snapshots to keep
	private documentStore: Map<string, GhostDocumentStoreItem> = new Map()
	private parserInitialized: boolean = false
	private astEnabled: boolean = false

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
		if (!this.astEnabled) {
			return
		}
		try {
			const uri = document.uri.toString()
			const item = this.documentStore.get(uri)

			if (!item) {
				return
			}

			// Initialize the parser if needed
			if (!this.parserInitialized) {
				try {
					// Use require for web-tree-sitter as in the original code
					const { Parser } = require("web-tree-sitter")
					await Parser.init()
					this.parserInitialized = true
				} catch (initError) {
					console.error("Failed to initialize tree-sitter parser:", initError)
					return
				}
			}

			// Get file extension to determine parser
			const filePath = document.uri.fsPath
			const ext = path.extname(filePath).substring(1).toLowerCase()

			try {
				// Load the appropriate language parser using require
				const { loadRequiredLanguageParsers } = require("../tree-sitter/languageParser")
				const languageParsers = await loadRequiredLanguageParsers([filePath])

				// Add proper type checking
				const parserInfo = languageParsers[ext] || {}
				// The parser object from the language parser module
				const parser = parserInfo.parser

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
			} catch (parserError) {
				console.error(`Error loading or using language parser for ${ext}:`, parserError)
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
	 * Remove a document completely from the store
	 * @param documentUri The URI of the document to remove
	 */
	public removeDocument(documentUri: vscode.Uri): void {
		const uri = documentUri.toString()

		// Clear any debounce timer for this document
		if (this.debounceTimers.has(uri)) {
			clearTimeout(this.debounceTimers.get(uri)!)
			this.debounceTimers.delete(uri)
		}

		// Remove the document from the store
		this.documentStore.delete(uri)
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
	 * Analyzes a single pair of document versions to extract meaningful changes
	 * @param oldContent Previous version of the document
	 * @param newContent Current version of the document
	 * @param filePath Path to the document
	 * @returns A collection of user actions representing the changes
	 */
	private analyzeDocumentChanges(oldContent: string, newContent: string, filePath: string): UserAction[] {
		// Generate a structured diff between the two versions
		const patch = structuredPatch(filePath, filePath, oldContent, newContent, "", "")
		const actions: UserAction[] = []

		// Process each hunk in the patch
		for (const hunk of patch.hunks) {
			// Track consecutive additions and deletions to group them
			let consecutiveAdditions: string[] = []
			let consecutiveDeletions: string[] = []
			let currentLineNumber = hunk.newStart

			// Process each line in the hunk
			for (const line of hunk.lines) {
				const operationType = line.charAt(0)
				const content = line.substring(1)

				switch (operationType) {
					case "+":
						// Addition
						consecutiveAdditions.push(content)
						currentLineNumber++
						break
					case "-":
						// Deletion
						consecutiveDeletions.push(content)
						break
					default:
						// Context line - process any pending additions/deletions
						this.processConsecutiveChanges(
							consecutiveAdditions,
							consecutiveDeletions,
							currentLineNumber - consecutiveAdditions.length,
							actions,
							filePath,
						)
						consecutiveAdditions = []
						consecutiveDeletions = []
						currentLineNumber++
						break
				}
			}

			// Process any remaining additions/deletions at the end of the hunk
			this.processConsecutiveChanges(
				consecutiveAdditions,
				consecutiveDeletions,
				currentLineNumber - consecutiveAdditions.length,
				actions,
				filePath,
			)
		}

		return actions
	}

	/**
	 * Process consecutive additions and deletions to determine the type of change
	 * @param additions Lines that were added
	 * @param deletions Lines that were deleted
	 * @param lineNumber Starting line number
	 * @param actions Array to add the resulting actions to
	 * @param filePath Path to the file being analyzed
	 */
	private processConsecutiveChanges(
		additions: string[],
		deletions: string[],
		lineNumber: number,
		actions: UserAction[],
		filePath: string,
	): void {
		if (additions.length === 0 && deletions.length === 0) {
			return // No changes to process
		}

		if (additions.length > 0 && deletions.length === 0) {
			// Pure addition
			actions.push(this.createAdditionAction(additions, lineNumber, filePath))
		} else if (additions.length === 0 && deletions.length > 0) {
			// Pure deletion
			actions.push(this.createDeletionAction(deletions, lineNumber, filePath))
		} else {
			// Check if this is a complete replacement (deletion followed by unrelated addition)
			const addedText = additions.join("\n").trim()
			const deletedText = deletions.join("\n").trim()

			// If the deleted text contains a variable declaration and the added text doesn't contain it,
			// it's likely a deletion rather than a modification
			const varMatch = deletedText.match(/(?:const|let|var|private|public|protected)\s+(\w+)/)
			if (varMatch && !addedText.includes(varMatch[1])) {
				// This is a deletion followed by an unrelated addition
				actions.push(this.createDeletionAction(deletions, lineNumber, filePath))
				if (addedText.length > 0) {
					actions.push(this.createAdditionAction(additions, lineNumber, filePath))
				}
			} else {
				// Regular modification (both additions and deletions)
				actions.push(this.createModificationAction(additions, deletions, lineNumber, filePath))
			}
		}
	}

	/**
	 * Creates an action representing code addition
	 * @param addedLines The lines that were added
	 * @param lineNumber The starting line number
	 * @param filePath Path to the file
	 * @returns A UserAction representing the addition
	 */
	private createAdditionAction(addedLines: string[], lineNumber: number, filePath: string): UserAction {
		const joinedLines = addedLines.join("\n")

		// Try to identify what was added
		let description = "Added code"
		let affectedSymbol = undefined
		const scope = undefined

		// Check for function/method definition
		const functionMatch = joinedLines.match(/(?:function|method|def)\s+(\w+)\s*\(/)
		if (functionMatch) {
			description = `Added function '${functionMatch[1]}'`
			affectedSymbol = functionMatch[1]
		}

		// Check for class definition
		const classMatch = joinedLines.match(/class\s+(\w+)/)
		if (classMatch) {
			description = `Added class '${classMatch[1]}'`
			affectedSymbol = classMatch[1]
		}

		// Check for variable declaration
		const varMatch = joinedLines.match(/(?:const|let|var|private|public|protected)\s+(\w+)/)
		if (varMatch) {
			description = `Added variable '${varMatch[1]}'`
			affectedSymbol = varMatch[1]
		}

		// If we couldn't identify a specific construct, try to be more descriptive
		if (description === "Added code") {
			if (joinedLines.includes("if") || joinedLines.includes("else")) {
				description = "Added conditional logic"
			} else if (joinedLines.includes("for") || joinedLines.includes("while")) {
				description = "Added loop"
			} else if (joinedLines.includes("try") || joinedLines.includes("catch")) {
				description = "Added error handling"
			} else if (joinedLines.includes("import") || joinedLines.includes("require")) {
				description = "Added import statement"
			} else if (joinedLines.trim().startsWith("//") || joinedLines.trim().startsWith("/*")) {
				description = "Added comment"
			}
		}

		return {
			type: UserActionType.ADDITION,
			description,
			lineRange: {
				start: lineNumber,
				end: lineNumber + addedLines.length - 1,
			},
			affectedSymbol,
			scope,
			content: joinedLines,
		}
	}

	/**
	 * Creates an action representing code deletion
	 * @param deletedLines The lines that were deleted
	 * @param lineNumber The starting line number
	 * @param filePath Path to the file
	 * @returns A UserAction representing the deletion
	 */
	private createDeletionAction(deletedLines: string[], lineNumber: number, filePath: string): UserAction {
		const joinedLines = deletedLines.join("\n")

		// Try to identify what was deleted
		let description = "Deleted code"
		let affectedSymbol = undefined
		const scope = undefined

		// Check for function/method definition
		const functionMatch = joinedLines.match(/(?:function|method|def)\s+(\w+)\s*\(/)
		if (functionMatch) {
			description = `Deleted function '${functionMatch[1]}'`
			affectedSymbol = functionMatch[1]
		}

		// Check for class definition
		const classMatch = joinedLines.match(/class\s+(\w+)/)
		if (classMatch) {
			description = `Deleted class '${classMatch[1]}'`
			affectedSymbol = classMatch[1]
		}

		// Check for variable declaration
		const varMatch = joinedLines.match(/(?:const|let|var|private|public|protected)\s+(\w+)/)
		if (varMatch) {
			description = `Deleted variable '${varMatch[1]}'`
			affectedSymbol = varMatch[1]
		}

		// If we couldn't identify a specific construct, try to be more descriptive
		if (description === "Deleted code") {
			if (joinedLines.includes("if") || joinedLines.includes("else")) {
				description = "Deleted conditional logic"
			} else if (joinedLines.includes("for") || joinedLines.includes("while")) {
				description = "Deleted loop"
			} else if (joinedLines.includes("try") || joinedLines.includes("catch")) {
				description = "Deleted error handling"
			} else if (joinedLines.includes("import") || joinedLines.includes("require")) {
				description = "Deleted import statement"
			} else if (joinedLines.trim().startsWith("//") || joinedLines.trim().startsWith("/*")) {
				description = "Deleted comment"
			}
		}

		return {
			type: UserActionType.DELETION,
			description,
			lineRange: {
				start: lineNumber,
				end: lineNumber + deletedLines.length - 1,
			},
			affectedSymbol,
			scope,
			content: joinedLines,
		}
	}

	/**
	 * Creates an action representing code modification
	 * @param addedLines The lines that were added
	 * @param deletedLines The lines that were deleted
	 * @param lineNumber The starting line number
	 * @param filePath Path to the file
	 * @returns A UserAction representing the modification
	 */
	private createModificationAction(
		addedLines: string[],
		deletedLines: string[],
		lineNumber: number,
		filePath: string,
	): UserAction {
		const addedText = addedLines.join("\n")
		const deletedText = deletedLines.join("\n")

		// Try to identify what was modified
		let description = "Modified code"
		let actionType = UserActionType.MODIFICATION
		let affectedSymbol = undefined
		const scope = undefined

		// Check if this is a rename operation
		const deletedSymbolMatch = deletedText.match(/\b(\w+)\b/)
		const addedSymbolMatch = addedText.match(/\b(\w+)\b/)

		if (
			deletedSymbolMatch &&
			addedSymbolMatch &&
			deletedText.replace(deletedSymbolMatch[1], addedSymbolMatch[1]) === addedText
		) {
			description = `Renamed '${deletedSymbolMatch[1]}' to '${addedSymbolMatch[1]}'`
			actionType = UserActionType.REFACTOR
			affectedSymbol = `${deletedSymbolMatch[1]} → ${addedSymbolMatch[1]}`
		}

		// Check if this is just a formatting change
		const isFormatChange = this.isFormattingChange(addedText, deletedText)
		if (isFormatChange) {
			description = "Reformatted code"
			actionType = UserActionType.FORMAT
		}

		// Check for condition changes in if statements
		const deletedConditionMatch = deletedText.match(/if\s*\((.*?)\)/)
		const addedConditionMatch = addedText.match(/if\s*\((.*?)\)/)
		if (deletedConditionMatch && addedConditionMatch) {
			description = "Modified condition in if statement"
		}

		// Check for changes in function parameters
		const deletedParamsMatch = deletedText.match(/\(\s*(.*?)\s*\)/)
		const addedParamsMatch = addedText.match(/\(\s*(.*?)\s*\)/)
		if (deletedParamsMatch && addedParamsMatch && deletedParamsMatch[1] !== addedParamsMatch[1]) {
			description = "Modified function parameters"
		}

		return {
			type: actionType,
			description,
			lineRange: {
				start: lineNumber,
				end: lineNumber + Math.max(addedLines.length, deletedLines.length) - 1,
			},
			affectedSymbol,
			scope,
			content: addedText, // For modifications, show the new content
		}
	}

	/**
	 * Determines if changes are purely formatting (whitespace, indentation)
	 * @param addedText The text that was added
	 * @param deletedText The text that was deleted
	 * @returns True if the changes appear to be formatting only
	 */
	private isFormattingChange(addedText: string, deletedText: string): boolean {
		// Remove all whitespace and compare
		const normalizedAdded = addedText.replace(/\s+/g, "")
		const normalizedDeleted = deletedText.replace(/\s+/g, "")
		return normalizedAdded === normalizedDeleted
	}

	/**
	 * Get the last 10 operations performed by the user on a document as meaningful actions
	 * @param document The document to get operations for
	 * @returns A collection of user action groups representing meaningful changes
	 */
	public getRecentOperations(document: vscode.TextDocument): UserAction[] {
		if (!document) {
			return []
		}

		const uri = document.uri.toString()
		const item = this.getDocument(document.uri)

		if (!item || item.history.length < 2) {
			return []
		}

		// Get the last 10 versions (or fewer if not available)
		const historyLimit = 2
		const startIdx = Math.max(0, item.history.length - historyLimit)
		const recentHistory = item.history.slice(startIdx)

		// If we have at least 2 versions, analyze the changes
		if (recentHistory.length >= 2) {
			const filePath = vscode.workspace.asRelativePath(document.uri)
			const allActions: UserAction[] = []

			// Analyze changes between consecutive versions
			for (let i = 0; i < recentHistory.length - 1; i++) {
				const oldContent = recentHistory[i]
				const newContent = recentHistory[i + 1]

				const actions = this.analyzeDocumentChanges(oldContent, newContent, filePath)
				allActions.push(...actions)
			}

			return allActions
		}

		return []
	}
}
