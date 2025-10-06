import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GroupRenderingDecision } from "./types"
import { GhostSuggestionsState, GhostSuggestionFile } from "./GhostSuggestions"

/**
 * VSCode InlineCompletionItemProvider integration for Ghost system.
 *
 * This provider is programmatically triggered by GhostProvider when it determines
 * that the generated suggestions are suitable for inline completion display.
 *
 * Architecture:
 * 1. GhostProvider generates suggestions normally
 * 2. GhostProvider checks if suggestions are suitable for inline completion
 * 3. If suitable, GhostProvider triggers VSCode's inline completion programmatically
 * 4. This provider converts the pre-generated suggestions to inline completion items
 * 5. If not suitable, GhostProvider uses decorators as usual
 *
 * Design principles:
 * - Only responds to programmatic triggers from GhostProvider (never user/automatic triggers)
 * - Converts pre-generated GhostSuggestionsState to inline completion format
 * - Focuses on same-line additions and simple modifications
 */
export class GhostInlineProvider implements vscode.InlineCompletionItemProvider {
	private static instance: GhostInlineProvider | null = null

	// Store the suggestions that GhostProvider wants to display as inline completion
	private pendingInlineSuggestions: GhostSuggestionsState | null = null
	private pendingCursorPosition: vscode.Position | null = null
	private documentChangeListener: vscode.Disposable | null = null

	// 🚀 CACHING STATE: Track cached suggestions for responsive typing behavior
	private currentCachedSuggestions: GhostSuggestionsState | null = null
	private currentBasePrefix: string = ""
	private currentBaseCursorPosition: vscode.Position | null = null

	private constructor() {
		// No dependencies - completely standalone!
		this.setupDocumentChangeListener()
	}

	public static getInstance(): GhostInlineProvider {
		if (!GhostInlineProvider.instance) {
			GhostInlineProvider.instance = new GhostInlineProvider()
		}
		return GhostInlineProvider.instance
	}

	/**
	 * Called by GhostProvider to set suggestions for inline completion display.
	 * This prepares the suggestions to be converted when VSCode requests inline completion.
	 */
	public setSuggestionsForInlineDisplay(suggestions: GhostSuggestionsState, cursorPosition: vscode.Position): void {
		console.log(
			`📝 GhostInlineProvider: Setting suggestions for inline display at position ${cursorPosition.line}:${cursorPosition.character}`,
		)
		this.pendingInlineSuggestions = suggestions
		this.pendingCursorPosition = cursorPosition
	}

	/**
	 * Clear any pending suggestions (called when suggestions are dismissed/applied)
	 */
	public clearPendingSuggestions(): void {
		console.log("🗑️ GhostInlineProvider: Clearing pending suggestions")
		this.pendingInlineSuggestions = null
		this.pendingCursorPosition = null
	}

	/**
	 * Set up document change listener to track typing behavior
	 */
	private setupDocumentChangeListener(): void {
		try {
			this.documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.pendingInlineSuggestions && this.pendingCursorPosition) {
					console.log("📝 GhostInlineProvider: Document changed while inline completion is active")
					console.log(`   📄 Document: ${event.document.fileName}`)
					console.log(`   🔢 Changes: ${event.contentChanges.length}`)
					event.contentChanges.forEach((change, index) => {
						console.log(
							`   Change ${index}: range=${change.range.start.line}:${change.range.start.character}-${change.range.end.line}:${change.range.end.character}, text="${change.text}"`,
						)
					})
				}
			})
		} catch (error) {
			// In test environments, vscode.workspace may not be fully available
			console.log("⚠️ GhostInlineProvider: Could not set up document change listener (test environment)")
			this.documentChangeListener = null
		}
	}

	/**
	 * VSCode InlineCompletionItemProvider interface implementation.
	 *
	 * Only responds when we have pending suggestions set by GhostProvider.
	 * Converts the pre-generated suggestions to inline completion format.
	 */
	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[]> {
		console.log(`🔄 GhostInlineProvider: provideInlineCompletionItems called`)
		console.log(`   📍 Position: ${position.line}:${position.character}`)
		console.log(`   📄 Document: ${document.fileName}`)
		console.log(`   🎯 TriggerKind: ${context.triggerKind}`)
		console.log(`   💡 Has pending suggestions: ${!!this.pendingInlineSuggestions}`)
		console.log(
			`   📌 Expected position: ${this.pendingCursorPosition?.line}:${this.pendingCursorPosition?.character}`,
		)

		// Get current line prefix for responsive typing logic
		const currentLinePrefix = this.getCurrentLinePrefix(document, position)

		// 🚀 RESPONSIVE TYPING: Check if user is extending a cached completion
		if (this.shouldUseCachedSuggestions(currentLinePrefix, position)) {
			const filteredSuggestions = this.filterSuggestionsForExtendedPrefix(
				this.currentCachedSuggestions!,
				currentLinePrefix,
				this.currentBasePrefix,
			)

			if (filteredSuggestions && filteredSuggestions.hasSuggestions()) {
				console.log("🚀 GhostInlineProvider: Using cached suggestions with prefix extension!")
				console.log(`   Base prefix: "${this.currentBasePrefix}"`)
				console.log(`   Current prefix: "${currentLinePrefix}"`)
				return this.convertSuggestionsToInlineItems(filteredSuggestions, document, position)
			}
		}

		// Only respond if we have pending suggestions from GhostProvider
		if (!this.pendingInlineSuggestions || !this.pendingCursorPosition) {
			console.log("❌ GhostInlineProvider: No pending suggestions, returning empty array")
			return []
		}

		// Verify the request is for the expected position (relaxed for responsive typing)
		const lineMatches = position.line === this.pendingCursorPosition.line
		const characterIsAfter = position.character >= this.pendingCursorPosition.character

		if (!lineMatches || !characterIsAfter) {
			console.log("❌ GhostInlineProvider: Position mismatch, returning empty array")
			console.log(`   Expected: ${this.pendingCursorPosition.line}:${this.pendingCursorPosition.character}`)
			console.log(`   Actual: ${position.line}:${position.character}`)
			return []
		}

		// Check if request was cancelled
		if (token.isCancellationRequested) {
			console.log("❌ GhostInlineProvider: Request cancelled, returning empty array")
			return []
		}

		try {
			// Store current state for future prefix matching
			this.updateCacheState(this.pendingInlineSuggestions, currentLinePrefix, position)

			// Convert the pre-generated suggestions to inline completion items
			const inlineItems = this.convertSuggestionsToInlineItems(this.pendingInlineSuggestions, document, position)

			console.log(`✅ GhostInlineProvider: Created ${inlineItems.length} inline completion items`)
			inlineItems.forEach((item, index) => {
				console.log(
					`   Item ${index}: "${typeof item.insertText === "string" ? item.insertText.substring(0, 50) : "[object]"}${typeof item.insertText === "string" && item.insertText.length > 50 ? "..." : ""}"`,
				)
			})

			// Clear the pending suggestions after conversion
			this.clearPendingSuggestions()

			return inlineItems
		} catch (error) {
			console.error("Error in GhostInlineProvider:", error)
			this.clearPendingSuggestions()
			return []
		}
	}

	/**
	 * Determine if suggestions are suitable for inline completion.
	 * Now supports hybrid rendering - returns true if ANY group can be displayed inline.
	 */
	public isSuitableForInlineCompletion(
		suggestions: GhostSuggestionsState,
		cursorPosition: vscode.Position,
		document?: vscode.TextDocument,
	): boolean {
		if (!suggestions.hasSuggestions()) {
			return false
		}

		// Get the first file's suggestions (we'll add multi-file support later if needed)
		const files = suggestions.getFiles()
		if (files.length !== 1) {
			// Multi-file suggestions should use decorators for better visualization
			return false
		}

		const file = files[0]
		const groups = file.getGroupsOperations()

		// Check if ANY group is suitable for inline completion (hybrid approach)
		for (const group of groups) {
			if (this.isGroupSuitableForInline(group, cursorPosition, document)) {
				return true
			}
		}

		return false
	}

	/**
	 * Evaluate each group individually for rendering mode.
	 * Returns decisions for hybrid rendering (some inline, some decorators).
	 */
	public evaluateGroupsForHybridRendering(
		suggestions: GhostSuggestionsState,
		cursorPosition: vscode.Position,
		document?: vscode.TextDocument,
	): GroupRenderingDecision[] {
		const decisions: GroupRenderingDecision[] = []

		if (!suggestions.hasSuggestions()) {
			return decisions
		}

		const files = suggestions.getFiles()
		if (files.length !== 1) {
			return decisions
		}

		const file = files[0]
		const groups = file.getGroupsOperations()

		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const group = groups[groupIndex]
			const isInlineSuitable = this.isGroupSuitableForInline(group, cursorPosition, document)

			decisions.push({
				groupIndex,
				renderingMode: isInlineSuitable ? "inline" : "decorator",
				targetPosition: isInlineSuitable ? this.calculateInlinePosition(group, cursorPosition) : undefined,
			})
		}

		return decisions
	}

	/**
	 * Calculate the optimal cursor position for displaying inline completion.
	 */
	private calculateInlinePosition(
		group: GhostSuggestionEditOperation[],
		cursorPosition: vscode.Position,
	): vscode.Position {
		// For now, use the cursor position - we can enhance this later for complex cases
		return cursorPosition
	}

	/**
	 * Check if a group of operations is suitable for inline completion.
	 * Only suitable if we're adding text after the cursor on the current line,
	 * or if the line prefix matches and we're extending it.
	 */
	public isGroupSuitableForInline(
		group: GhostSuggestionEditOperation[],
		cursorPosition: vscode.Position,
		document?: vscode.TextDocument,
	): boolean {
		// Get the document to check line content
		let currentDocument = document
		if (!currentDocument) {
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				return false
			}
			currentDocument = editor.document
		}
		const cursorLine = cursorPosition.line

		// Get current line content and cursor position within it
		if (cursorLine >= currentDocument.lineCount) {
			return false
		}

		const currentLineText = currentDocument.lineAt(cursorLine).text
		const cursorChar = cursorPosition.character
		const linePrefix = currentLineText.slice(0, cursorChar)
		const lineSuffix = currentLineText.slice(cursorChar)

		// Case 1: Single addition - check cursor line or adjacent empty lines
		if (group.length === 1 && group[0].type === "+") {
			const operation = group[0]
			const operationLine = operation.line
			const addedContent = operation.content

			// Case 1a: Operation is directly on cursor line
			if (operationLine === cursorLine) {
				// Check if we're adding to empty line (cursor at start)
				if (currentLineText.trim() === "" && cursorChar === 0) {
					return true
				}

				// Check if added content extends after cursor position
				if (addedContent.startsWith(lineSuffix) || lineSuffix === "") {
					return true
				}
			}

			// Case 1b: Operation is on adjacent line and cursor is on empty line
			const lineDiff = Math.abs(operationLine - cursorLine)
			if (lineDiff === 1 && currentLineText.trim() === "") {
				// Cursor is on empty line adjacent to where content will be added
				return true
			}

			// Case 1c: Operation is on next line and cursor is at end of current line
			if (operationLine === cursorLine + 1 && cursorChar === currentLineText.length) {
				// Cursor is at end of current line, adding content to next line
				console.log(`🎯 Inline suitable: cursor at end of line ${cursorLine}, adding to line ${operationLine}`)
				return true
			}

			return false
		}

		// Case 2: Multiple operations - be selective about complex modifications
		if (group.length > 1) {
			// Complex modifications with delete+add operations should use decorators
			// for better visualization of what's being changed
			const hasDelete = group.some((op) => op.type === "-")
			const hasAdd = group.some((op) => op.type === "+")

			if (hasDelete && hasAdd) {
				// Delete+add modifications are complex - use decorators for clarity
				return false
			}

			// Multiple additions - only suitable if they start from cursor line and are simple
			if (group.every((op) => op.type === "+") && group.length <= 3) {
				const lines = group.map((op) => op.line).sort((a, b) => a - b)
				const startLine = lines[0]

				// Must start from cursor line or adjacent line with empty cursor line
				if (startLine === cursorLine) {
					// Check if lines are consecutive
					for (let i = 1; i < lines.length; i++) {
						if (lines[i] !== lines[i - 1] + 1) {
							return false
						}
					}
					return true
				}

				if (Math.abs(startLine - cursorLine) === 1 && currentLineText.trim() === "") {
					// Cursor is on empty line adjacent to where content will be added
					// Check if lines are consecutive
					for (let i = 1; i < lines.length; i++) {
						if (lines[i] !== lines[i - 1] + 1) {
							return false
						}
					}
					return true
				}
			}

			// All other complex operations use decorators
			return false
		}

		// All other cases use decorators
		return false
	}

	/**
	 * Convert GhostSuggestionEditOperations to VSCode InlineCompletionItems.
	 */
	private convertSuggestionsToInlineItems(
		suggestions: GhostSuggestionsState,
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.InlineCompletionItem[] {
		const items: vscode.InlineCompletionItem[] = []

		const files = suggestions.getFiles()
		const file = files[0] // We already verified single file in isSuitableForInlineCompletion

		const groups = file.getGroupsOperations()

		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const group = groups[groupIndex]
			const inlineItem = this.convertGroupToInlineItem(group, document, position, groupIndex)

			if (inlineItem) {
				items.push(inlineItem)
			}
		}

		return items
	}

	/**
	 * Convert a single group of operations to an InlineCompletionItem.
	 */
	private convertGroupToInlineItem(
		group: GhostSuggestionEditOperation[],
		document: vscode.TextDocument,
		position: vscode.Position,
		groupIndex: number,
	): vscode.InlineCompletionItem | null {
		try {
			// Handle single addition - most common inline case
			if (group.length === 1 && group[0].type === "+") {
				const operation = group[0]
				return this.createInlineItemForAddition(operation, document, position, groupIndex)
			}

			// Handle modification (delete + add)
			if (group.length === 2) {
				const deleteOp = group.find((op) => op.type === "-")
				const addOp = group.find((op) => op.type === "+")

				if (deleteOp && addOp) {
					return this.createInlineItemForModification(deleteOp, addOp, document, position, groupIndex)
				}
			}

			// Handle multiple consecutive additions
			if (group.every((op) => op.type === "+")) {
				return this.createInlineItemForMultipleAdditions(group, document, position, groupIndex)
			}

			return null
		} catch (error) {
			console.error("Error converting group to inline item:", error)
			return null
		}
	}

	/**
	 * Create inline completion item for a single addition operation.
	 */
	private createInlineItemForAddition(
		operation: GhostSuggestionEditOperation,
		document: vscode.TextDocument,
		position: vscode.Position,
		groupIndex: number,
	): vscode.InlineCompletionItem {
		const insertText = operation.content

		// For additions, insert at the cursor position
		const insertPosition = position
		const range = new vscode.Range(insertPosition, insertPosition)

		return new vscode.InlineCompletionItem(insertText, range, {
			title: `Ghost Suggestion ${groupIndex + 1}`,
			command: "kilocode.ghost.acceptInlineCompletion",
			arguments: [operation, groupIndex],
		})
	}

	/**
	 * Create inline completion item for a modification (delete + add).
	 */
	private createInlineItemForModification(
		deleteOp: GhostSuggestionEditOperation,
		addOp: GhostSuggestionEditOperation,
		document: vscode.TextDocument,
		position: vscode.Position,
		groupIndex: number,
	): vscode.InlineCompletionItem {
		const insertText = addOp.content

		// For modifications, replace the line content where the delete operation occurs
		const targetLine = deleteOp.line
		if (targetLine >= document.lineCount) {
			// Fallback to cursor position if line doesn't exist
			return new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position), {
				title: `Ghost Modification ${groupIndex + 1}`,
				command: "kilocode.ghost.acceptInlineCompletion",
				arguments: [[deleteOp, addOp], groupIndex],
			})
		}

		const line = document.lineAt(targetLine)
		const range = new vscode.Range(
			new vscode.Position(targetLine, 0),
			new vscode.Position(targetLine, line.text.length),
		)

		return new vscode.InlineCompletionItem(insertText, range, {
			title: `Ghost Modification ${groupIndex + 1}`,
			command: "kilocode.ghost.acceptInlineCompletion",
			arguments: [[deleteOp, addOp], groupIndex],
		})
	}

	/**
	 * Create inline completion item for multiple consecutive additions.
	 */
	private createInlineItemForMultipleAdditions(
		group: GhostSuggestionEditOperation[],
		document: vscode.TextDocument,
		position: vscode.Position,
		groupIndex: number,
	): vscode.InlineCompletionItem {
		// Combine all addition content
		const insertText = group.map((op) => op.content).join("\n")

		// Insert at cursor position
		const range = new vscode.Range(position, position)

		return new vscode.InlineCompletionItem(insertText, range, {
			title: `Ghost Multi-line ${groupIndex + 1}`,
			command: "kilocode.ghost.acceptInlineCompletion",
			arguments: [group, groupIndex],
		})
	}

	/**
	 * 🚀 RESPONSIVE TYPING HELPER METHODS
	 * These methods enable completions to persist as users type matching prefixes
	 */

	/**
	 * Get current line prefix up to cursor position
	 */
	private getCurrentLinePrefix(document: vscode.TextDocument, position: vscode.Position): string {
		if (position.line >= document.lineCount) {
			return ""
		}
		const line = document.lineAt(position.line).text
		return line.substring(0, position.character)
	}

	/**
	 * Check if we should use cached suggestions for extended prefix matching
	 */
	private shouldUseCachedSuggestions(currentPrefix: string, position: vscode.Position): boolean {
		// Must have cached suggestions and base state
		if (!this.currentCachedSuggestions || !this.currentBaseCursorPosition || !this.currentBasePrefix) {
			return false
		}

		// Must be on the same line
		if (position.line !== this.currentBaseCursorPosition.line) {
			return false
		}

		// Current prefix must extend the base prefix (user is typing forward)
		if (!currentPrefix.startsWith(this.currentBasePrefix)) {
			return false
		}

		// Must have additional characters typed (extending the prefix)
		if (currentPrefix.length <= this.currentBasePrefix.length) {
			return false
		}

		return true
	}

	/**
	 * Filter cached suggestions to match the extended prefix
	 * This is where the magic happens - keeping suggestions visible as user types
	 */
	private filterSuggestionsForExtendedPrefix(
		suggestions: GhostSuggestionsState,
		currentPrefix: string,
		basePrefix: string,
	): GhostSuggestionsState | null {
		// Get the additional characters typed since the base
		const additionalChars = currentPrefix.slice(basePrefix.length)

		// For now, this is a simplified implementation
		// A more sophisticated version would check if the suggestion content
		// actually starts with the additional characters

		// Get the first file's suggestions (most common case)
		const files = suggestions.getFiles()
		if (files.length !== 1) {
			return null // Multi-file suggestions need more complex logic
		}

		const file = files[0]
		const groups = file.getGroupsOperations()

		// Check if any group has operations that could match the extended prefix
		for (const group of groups) {
			for (const operation of group) {
				if (operation.type === "+" && operation.content.startsWith(additionalChars)) {
					// This suggestion matches the extended typing - return it
					return suggestions
				}
			}
		}

		// No matching suggestions found
		return null
	}

	/**
	 * Update cache state for future prefix matching
	 */
	private updateCacheState(
		suggestions: GhostSuggestionsState | null,
		prefix: string,
		position: vscode.Position,
	): void {
		this.currentCachedSuggestions = suggestions
		this.currentBasePrefix = prefix
		this.currentBaseCursorPosition = position

		console.log(`🎯 GhostInlineProvider: Updated cache state`, {
			hassuggestions: !!suggestions,
			basePrefix: prefix,
			baseCursorPosition: `${position.line}:${position.character}`,
		})
	}
}
