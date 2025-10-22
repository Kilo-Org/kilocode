import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"

// Constants
const PLACEHOLDER_TEXT = "<<<AUTOCOMPLETE_HERE>>>"
const MAX_CURSOR_DISTANCE = 5
const COMMON_PREFIX_THRESHOLD = 0.8

/**
 * Inline Completion Provider for Ghost Code Suggestions
 *
 * Provides ghost text completions at the cursor position based on
 * the currently selected suggestion group using VS Code's native
 * inline completion API.
 */
export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestions: GhostSuggestionsState
	private onIntelliSenseDetected?: () => void

	constructor(suggestions: GhostSuggestionsState, onIntelliSenseDetected?: () => void) {
		this.suggestions = suggestions
		this.onIntelliSenseDetected = onIntelliSenseDetected
	}

	/**
	 * Update the suggestions reference
	 */
	public updateSuggestions(suggestions: GhostSuggestionsState): void {
		this.suggestions = suggestions
	}

	/**
	 * Extract and join content from operations
	 */
	private extractContent(operations: GhostSuggestionEditOperation[], type?: "+" | "-"): string {
		const filtered = type ? operations.filter((op) => op.type === type) : operations
		return filtered
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
	}

	/**
	 * Check if content is placeholder-only
	 */
	private isPlaceholderContent(content: string): boolean {
		return content.trim() === PLACEHOLDER_TEXT
	}

	/**
	 * Check if a deletion group is placeholder-only
	 */
	private isPlaceholderOnlyDeletion(group: GhostSuggestionEditOperation[]): boolean {
		const deletedContent = this.extractContent(group, "-")
		return this.isPlaceholderContent(deletedContent)
	}

	/**
	 * Find common prefix between two strings
	 */
	private findCommonPrefix(str1: string, str2: string): string {
		let i = 0
		while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
			i++
		}
		return str1.substring(0, i)
	}

	/**
	 * Check if added content has common prefix with deleted content
	 */
	private isPrefix(deletedContent: string, addedContent: string): boolean {
		return addedContent.startsWith(deletedContent)
	}

	/**
	 * Check if deletion+addition should be treated as pure addition
	 */
	private shouldTreatAsAddition(deletedContent: string, addedContent: string): boolean {
		// If added content starts with deleted content, let common prefix logic handle this
		if (this.isPrefix(deletedContent, addedContent)) {
			return false
		}

		// Added content starts with newline - indicates LLM wants to add content after current line
		return addedContent.startsWith("\n") || addedContent.startsWith("\r\n")
	}

	private shouldHandleGroupInline(groupType: "+" | "/" | "-", group?: GhostSuggestionEditOperation[]): boolean {
		// Always show pure additions
		if (groupType === "+") {
			return true
		}

		// For modifications, allow completions with common prefix
		if (groupType === "/" && group) {
			const deletedContent = this.extractContent(group, "-")
			const addedContent = this.extractContent(group, "+")

			if (deletedContent && addedContent && this.isPrefix(deletedContent, addedContent)) {
				return true
			}
		}

		// Don't show deletions or non-prefix modifications
		return false
	}

	/**
	 * Calculate target line for a group
	 */
	private getTargetLine(
		group: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		offset: { added: number; removed: number },
	): number {
		// For modifications, use the deletion line without offsets
		if (groupType === "/") {
			const deleteOp = group.find((op) => op.type === "-")
			return deleteOp ? deleteOp.line : group[0].line
		}

		// For additions, apply the offset to account for previously removed lines
		if (groupType === "+") {
			return group[0].line + offset.removed
		}

		// For deletions
		return group[0].line + offset.added
	}

	/**
	 * Check if group is within cursor distance
	 */
	private isWithinCursorDistance(cursorLine: number, targetLine: number): boolean {
		return Math.abs(cursorLine - targetLine) <= MAX_CURSOR_DISTANCE
	}

	/**
	 * Check if modification has valid common prefix for inline completion
	 */
	private hasValidCommonPrefixForInline(group: GhostSuggestionEditOperation[]): boolean {
		const deletedContent = this.extractContent(group, "-")
		const addedContent = this.extractContent(group, "+")

		if (!deletedContent || !addedContent) {
			return false
		}

		// If deleted content is empty or placeholder, treat as pure addition
		const trimmedDeleted = deletedContent.trim()
		if (trimmedDeleted.length === 0 || this.isPlaceholderContent(trimmedDeleted)) {
			return true
		}

		// Check if should be treated as addition
		if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
			return true
		}

		// Check for common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		return commonPrefix.length > 0
	}

	/**
	 * Determine if a group should use inline completion instead of SVG decoration
	 */
	public shouldUseInlineCompletion(
		selectedGroup: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		cursorLine: number,
		file: any,
	): boolean {
		// First check if this group type should be shown at all
		if (!this.shouldHandleGroupInline(groupType, selectedGroup)) {
			return false
		}

		// Deletions never use inline
		if (groupType === "-") {
			return false
		}

		// Check distance from cursor
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const targetLine = this.getTargetLine(selectedGroup, groupType, offset)

		if (!this.isWithinCursorDistance(cursorLine, targetLine)) {
			return false
		}

		// Pure additions always use inline
		if (groupType === "+") {
			return true
		}

		// For modifications, check if there's a valid common prefix
		return this.hasValidCommonPrefixForInline(selectedGroup)
	}

	/**
	 * Determine if inline suggestions should be triggered for current state
	 */
	public shouldTriggerInline(editor: vscode.TextEditor): boolean {
		if (!this.suggestions.hasSuggestions()) {
			return false
		}

		const file = this.suggestions.getFile(editor.document.uri)
		if (!file) {
			return false
		}

		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		if (selectedGroupIndex === null || selectedGroupIndex >= groups.length) {
			return false
		}

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		return this.shouldUseInlineCompletion(selectedGroup, selectedGroupType, editor.selection.active.line, file)
	}

	/**
	 * Check if deletion and addition groups should be combined
	 *
	 * MULTI-GROUP COMBINATIONS:
	 * This is a core part of handling LLM suggestions that come as separate deletion and addition
	 * groups but should be treated as a single modification. When the LLM generates diffs,
	 * it sometimes produces:
	 *   Group 1 (deletion): "const x ="
	 *   Group 2 (addition): "const x = 10"
	 *
	 * These should be combined into a synthetic modification group so the inline completion
	 * shows only the suffix (e.g., " 10") rather than the entire addition. This provides a
	 * better user experience by showing only what's actually being added/changed.
	 */
	private shouldCombineGroups(deletedContent: string, addedContent: string): boolean {
		return (
			this.isPrefix(deletedContent, addedContent) ||
			this.isPlaceholderContent(deletedContent) ||
			addedContent.startsWith("\n") ||
			addedContent.startsWith("\r\n")
		)
	}

	/**
	 * Get indices of groups that should be skipped for SVG decorations
	 */
	public getSkipGroupIndices(file: any, editor: vscode.TextEditor): number[] {
		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		if (selectedGroupIndex === null) {
			return []
		}

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)
		const skipGroupIndices: number[] = []

		// Filter out groups based on onlyAdditions setting
		for (let i = 0; i < groups.length; i++) {
			const group = groups[i]
			const groupType = file.getGroupType(group)

			if (!this.shouldHandleGroupInline(groupType, group)) {
				skipGroupIndices.push(i)
			}
		}

		// Check if selected group uses inline completion
		const selectedGroupUsesInline = this.shouldUseInlineCompletion(
			selectedGroup,
			selectedGroupType,
			editor.selection.active.line,
			file,
		)

		if (selectedGroupUsesInline) {
			// Always skip the selected group if it uses inline completion
			if (!skipGroupIndices.includes(selectedGroupIndex)) {
				skipGroupIndices.push(selectedGroupIndex)
			}

			// Skip associated addition group if this is a synthetic modification
			if (selectedGroupType === "-" && selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				if (nextGroupType === "+") {
					const deletedContent = this.extractContent(selectedGroup, "-")
					const addedContent = this.extractContent(nextGroup, "+")

					if (this.shouldCombineGroups(deletedContent, addedContent)) {
						if (!skipGroupIndices.includes(selectedGroupIndex + 1)) {
							skipGroupIndices.push(selectedGroupIndex + 1)
						}
					}
				}
			}

			// Hide ALL other groups to prevent multiple suggestions simultaneously
			for (let i = 0; i < groups.length; i++) {
				if (i !== selectedGroupIndex && !skipGroupIndices.includes(i)) {
					skipGroupIndices.push(i)
				}
			}
		}

		return skipGroupIndices
	}

	/**
	 * Check if group is valid to show
	 */
	private isValidGroup(group: GhostSuggestionEditOperation[], groupType: "+" | "/" | "-"): boolean {
		const isPlaceholder = groupType === "-" && this.isPlaceholderOnlyDeletion(group)
		const shouldHandleGroupInline = this.shouldHandleGroupInline(groupType, group)
		return !isPlaceholder && shouldHandleGroupInline
	}

	/**
	 * Find next valid group index
	 */
	public findNextValidGroup(file: any, startIndex: number): number | null {
		const groups = file.getGroupsOperations()
		const maxAttempts = groups.length
		let attempts = 0
		let currentIndex = startIndex

		while (attempts < maxAttempts) {
			file.selectNextGroup()
			attempts++
			currentIndex = file.getSelectedGroup()

			if (currentIndex !== null && currentIndex < groups.length) {
				const currentGroup = groups[currentIndex]
				const currentGroupType = file.getGroupType(currentGroup)

				if (this.isValidGroup(currentGroup, currentGroupType)) {
					return currentIndex
				}
			}

			if (currentIndex === startIndex) {
				break
			}
		}

		return null
	}

	/**
	 * Find previous valid group index
	 */
	public findPreviousValidGroup(file: any, startIndex: number): number | null {
		const groups = file.getGroupsOperations()
		const maxAttempts = groups.length
		let attempts = 0
		let currentIndex = startIndex

		while (attempts < maxAttempts) {
			file.selectPreviousGroup()
			attempts++
			currentIndex = file.getSelectedGroup()

			if (currentIndex !== null && currentIndex < groups.length) {
				const currentGroup = groups[currentIndex]
				const currentGroupType = file.getGroupType(currentGroup)

				if (this.isValidGroup(currentGroup, currentGroupType)) {
					return currentIndex
				}
			}

			if (currentIndex === startIndex) {
				break
			}
		}

		return null
	}

	/**
	 * Select closest valid group after initial selection
	 */
	public selectClosestValidGroup(file: any, editor: vscode.TextEditor): void {
		const selectedGroupIndex = file.getSelectedGroup()
		if (selectedGroupIndex === null) {
			return
		}

		const groups = file.getGroupsOperations()
		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		if (!this.isValidGroup(selectedGroup, selectedGroupType)) {
			this.findNextValidGroup(file, selectedGroupIndex)
		}
	}

	/**
	 * Get the next addition group if it exists
	 */
	private getNextAdditionGroup(
		file: any,
		groups: GhostSuggestionEditOperation[][],
		currentIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "+" } | null {
		if (currentIndex + 1 < groups.length) {
			const nextGroup = groups[currentIndex + 1]
			const nextGroupType = file.getGroupType(nextGroup)

			if (nextGroupType === "+") {
				return { group: nextGroup, type: "+" }
			}
		}
		return null
	}

	/**
	 * Check if groups should be combined into synthetic modification
	 */
	private shouldCreateSyntheticModification(
		previousGroup: GhostSuggestionEditOperation[],
		currentGroup: GhostSuggestionEditOperation[],
	): boolean {
		const deletedContent = this.extractContent(previousGroup, "-")
		const addedContent = this.extractContent(currentGroup, "+")

		if (!deletedContent || !addedContent) {
			return false
		}

		const trimmedDeleted = deletedContent.trim()
		const commonPrefix = this.findCommonPrefix(trimmedDeleted, addedContent)

		return commonPrefix.length > 0 && commonPrefix.length >= trimmedDeleted.length * COMMON_PREFIX_THRESHOLD
	}

	/**
	 * Handle modification group with empty deletion
	 *
	 * SUBSEQUENT ADDITION GROUP MERGING:
	 * When a modification has an empty or placeholder deletion (e.g., "<<<AUTOCOMPLETE_HERE>>>"),
	 * it's actually a pure addition. However, the LLM may split this addition across multiple
	 * groups:
	 *   Group 1 (modification): - "<<<AUTOCOMPLETE_HERE>>>" + "function foo() {"
	 *   Group 2 (addition): "  return 42;"
	 *   Group 3 (addition): "}"
	 *
	 * This function merges all subsequent addition groups (lines 488-500) into a single combined
	 * group. This ensures the inline completion shows the complete multi-line addition as one
	 * cohesive suggestion, rather than requiring the user to navigate through multiple separate
	 * groups. Without this merging, the user would see:
	 *   - First: "function foo() {"
	 *   - Tab to next: "  return 42;"
	 *   - Tab to next: "}"
	 *
	 * With merging, they see the complete function in one go, which is more natural and efficient.
	 */
	private handleEmptyDeletionModification(
		group: GhostSuggestionEditOperation[],
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
		file: any,
	): { group: GhostSuggestionEditOperation[]; type: "+" } | null {
		const deletedContent = this.extractContent(group, "-").trim()

		if (deletedContent.length === 0 || this.isPlaceholderContent(deletedContent)) {
			const addOps = group.filter((op) => op.type === "+")
			const combinedOps = [...addOps]

			// Add subsequent addition groups
			let nextIndex = selectedGroupIndex + 1
			while (nextIndex < groups.length) {
				const nextGroup = groups[nextIndex]
				const nextGroupType = file.getGroupType(nextGroup)

				if (nextGroupType === "+") {
					combinedOps.push(...nextGroup)
					nextIndex++
				} else {
					break
				}
			}

			return { group: combinedOps, type: "+" }
		}

		return null
	}

	/**
	 * Handle deletion group with associated addition
	 */
	private handleDeletionWithAddition(
		selectedGroup: GhostSuggestionEditOperation[],
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
		file: any,
	): { group: GhostSuggestionEditOperation[]; type: "/" | "+" } | null {
		const deletedContent = this.extractContent(selectedGroup, "-").trim()

		// Case 1: Placeholder-only deletion
		if (this.isPlaceholderContent(deletedContent)) {
			return this.getNextAdditionGroup(file, groups, selectedGroupIndex)
		}

		// Case 2: Deletion followed by addition
		if (selectedGroupIndex + 1 < groups.length) {
			const nextGroup = groups[selectedGroupIndex + 1]
			const nextGroupType = file.getGroupType(nextGroup)

			if (nextGroupType === "+") {
				const addedContent = this.extractContent(nextGroup, "+")

				// Common prefix scenario - create synthetic modification
				if (this.isPrefix(deletedContent, addedContent)) {
					console.log("[InlineCompletion] Common prefix detected, creating synthetic modification group")
					console.log("[InlineCompletion] Deleted:", deletedContent.substring(0, 50))
					console.log("[InlineCompletion] Added:", addedContent.substring(0, 50))
					return { group: [...selectedGroup, ...nextGroup], type: "/" }
				}

				// Should be treated as addition after existing content
				if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
					return { group: nextGroup, type: "+" }
				}
			}
		}

		return null
	}

	/**
	 * Handle addition group that may need combination with previous deletion
	 */
	private handleAdditionWithPreviousDeletion(
		selectedGroup: GhostSuggestionEditOperation[],
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "/" } | null {
		if (selectedGroupIndex <= 0) {
			return null
		}

		const previousGroup = groups[selectedGroupIndex - 1]
		const previousGroupType = (previousGroup[0]?.type === "-" ? "-" : "+") as "+" | "-"

		if (previousGroupType === "-" && this.shouldCreateSyntheticModification(previousGroup, selectedGroup)) {
			return { group: [...previousGroup, ...selectedGroup], type: "/" }
		}

		return null
	}

	/**
	 * Get effective group for inline completion (handles separated deletion+addition groups)
	 */
	private getEffectiveGroup(
		file: any,
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "+" | "/" | "-" } | null {
		if (selectedGroupIndex >= groups.length) {
			return null
		}

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		// Handle modification with empty deletion
		if (selectedGroupType === "/") {
			const result = this.handleEmptyDeletionModification(selectedGroup, groups, selectedGroupIndex, file)
			if (result) return result
		}

		// Handle deletion with associated addition
		if (selectedGroupType === "-") {
			const result = this.handleDeletionWithAddition(selectedGroup, groups, selectedGroupIndex, file)
			if (result) return result
			return null // Regular deletions use SVG decorations
		}

		// Handle addition that may combine with previous deletion
		if (selectedGroupType === "+") {
			const result = this.handleAdditionWithPreviousDeletion(selectedGroup, groups, selectedGroupIndex)
			if (result) return result
		}

		return { group: selectedGroup, type: selectedGroupType }
	}

	/**
	 * Get completion text for addition that may be part of modification
	 *
	 * FIRST-LINE PREFIX WITH MULTI-LINE ADDITIONS:
	 * This handles a complex scenario where the LLM generates suggestions with a common prefix
	 * on the first line, followed by additional lines. For example:
	 *   Previous deletion: "const x ="
	 *   Addition group:    "const x = 10\n  + 20\n  + 30"
	 *
	 * There are two cases to handle:
	 *
	 * 1. Entire addition starts with deletion (lines 634-636):
	 *    If the whole addition text begins with the deleted content, we strip the common prefix
	 *    from the entire text. This is straightforward prefix removal.
	 *
	 * 2. Only first line starts with deletion (lines 638-642):
	 *    More complex - only the first operation's content contains the prefix, but subsequent
	 *    lines don't. We need to:
	 *    a) Extract the suffix from the first line after removing the prefix
	 *    b) Keep all subsequent lines intact
	 *    c) Join them with newlines
	 *
	 *    Example result: " 10\n  + 20\n  + 30" (only " 10" is shown inline on first line,
	 *    then the remaining lines appear below)
	 *
	 * This approach allows for natural inline completion of multi-line suggestions where
	 * the first line modifies existing code and subsequent lines add new content below it.
	 * Without this logic, the inline completion would show redundant text that's already
	 * on the line.
	 */
	private getAdditionCompletionText(
		group: GhostSuggestionEditOperation[],
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
		file: any,
	): { text: string; isAddition: boolean } {
		const text = this.extractContent(group)
		const sortedOps = group.sort((a, b) => a.line - b.line)

		// Check if there's a previous deletion group
		if (selectedGroupIndex > 0) {
			const previousGroup = groups[selectedGroupIndex - 1]
			const previousGroupType = file.getGroupType(previousGroup)

			if (previousGroupType === "-") {
				const deletedContent = this.extractContent(previousGroup, "-")

				// If entire addition starts with deletion, strip common prefix
				if (this.isPrefix(deletedContent, text)) {
					return { text: text.substring(deletedContent.length), isAddition: false }
				}

				// Check if just first line starts with deletion
				if (sortedOps.length > 0 && sortedOps[0].content.startsWith(deletedContent)) {
					const firstLineSuffix = sortedOps[0].content.substring(deletedContent.length)
					const remainingLines = sortedOps.slice(1).map((op) => op.content)
					return { text: [firstLineSuffix, ...remainingLines].join("\n"), isAddition: false }
				}
			}
		}

		return { text, isAddition: true }
	}

	/**
	 * Get completion text for modification
	 */
	private getModificationCompletionText(
		group: GhostSuggestionEditOperation[],
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
		file: any,
	): { text: string; isAddition: boolean } {
		const deletedContent = this.extractContent(group, "-")
		const addedContent = this.extractContent(group, "+")

		if (!deletedContent || !addedContent) {
			return { text: "", isAddition: false }
		}

		const trimmedDeleted = deletedContent.trim()

		// Empty or placeholder deletion - show all added content
		if (trimmedDeleted.length === 0 || this.isPlaceholderContent(trimmedDeleted)) {
			return { text: addedContent, isAddition: true }
		}

		// Should be treated as addition
		if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
			if (this.isPrefix(deletedContent, addedContent)) {
				return { text: addedContent.substring(deletedContent.length), isAddition: false }
			} else if (addedContent.startsWith("\n") || addedContent.startsWith("\r\n")) {
				return { text: addedContent.replace(/^\r?\n/, ""), isAddition: true }
			}
		}

		// Regular modification - show suffix after common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		if (commonPrefix.length === 0) {
			return { text: "", isAddition: false }
		}

		const suffix = addedContent.substring(commonPrefix.length)

		// Check if there are subsequent addition groups to combine
		if (selectedGroupIndex + 1 < groups.length) {
			const nextGroup = groups[selectedGroupIndex + 1]
			const nextGroupType = file.getGroupType(nextGroup)

			if (nextGroupType === "+") {
				const nextAdditions = this.extractContent(nextGroup)
				return { text: suffix + "\n" + nextAdditions, isAddition: false }
			}
		}

		return { text: suffix, isAddition: false }
	}

	/**
	 * Calculate completion text for different scenarios
	 */
	private getCompletionText(
		groupType: "+" | "/" | "-",
		group: GhostSuggestionEditOperation[],
		file: any,
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { text: string; isAddition: boolean } {
		if (groupType === "+") {
			return this.getAdditionCompletionText(group, groups, selectedGroupIndex, file)
		}

		return this.getModificationCompletionText(group, groups, selectedGroupIndex, file)
	}

	/**
	 * Calculate insertion position and range
	 */
	private getInsertionRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		targetLine: number,
		isAddition: boolean,
		completionText: string,
	): vscode.Range {
		// For pure additions, position at end of current line
		if (isAddition) {
			const currentLineText = document.lineAt(position.line).text
			const insertPosition = new vscode.Position(position.line, currentLineText.length)
			return new vscode.Range(insertPosition, insertPosition)
		}

		// For modifications on same line with multi-line content
		if (targetLine === position.line) {
			if (completionText.includes("\n")) {
				const nextLine = Math.min(position.line + 1, document.lineCount)
				const insertPosition = new vscode.Position(nextLine, 0)
				return new vscode.Range(insertPosition, insertPosition)
			} else {
				return new vscode.Range(position, position)
			}
		}

		// For different lines
		if (targetLine >= document.lineCount) {
			const lastLineIndex = Math.max(0, document.lineCount - 1)
			const lastLineText = document.lineAt(lastLineIndex).text
			const insertPosition = new vscode.Position(lastLineIndex, lastLineText.length)
			return new vscode.Range(insertPosition, insertPosition)
		}

		const insertPosition = new vscode.Position(targetLine, 0)
		return new vscode.Range(insertPosition, insertPosition)
	}

	/**
	 * Provide inline completion items at the given position
	 */
	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		if (token.isCancellationRequested) {
			return undefined
		}

		// Suppress inline completion when IntelliSense is showing
		if (context.selectedCompletionInfo) {
			if (this.onIntelliSenseDetected) {
				this.onIntelliSenseDetected()
			}
			return undefined
		}

		// Get file suggestions
		const file = this.suggestions.getFile(document.uri)
		if (!file) {
			return undefined
		}

		// Get effective group
		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		if (selectedGroupIndex === null) {
			return undefined
		}

		const effectiveGroup = this.getEffectiveGroup(file, groups, selectedGroupIndex)
		if (!effectiveGroup) {
			return undefined
		}

		// Check distance from cursor
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const targetLine = this.getTargetLine(effectiveGroup.group, effectiveGroup.type, offset)

		if (!this.isWithinCursorDistance(position.line, targetLine)) {
			return undefined
		}

		// Get completion text
		const { text: completionText, isAddition } = this.getCompletionText(
			effectiveGroup.type,
			effectiveGroup.group,
			file,
			groups,
			selectedGroupIndex,
		)

		if (!completionText.trim()) {
			return undefined
		}

		// Calculate insertion range
		const range = this.getInsertionRange(document, position, targetLine, isAddition, completionText)
		let finalCompletionText = completionText

		// Add newline prefix if needed for multi-line content
		if (isAddition && completionText.includes("\n") && !completionText.startsWith("\n")) {
			finalCompletionText = "\n" + completionText
		} else if (
			!isAddition &&
			completionText.includes("\n") &&
			range.start.line === position.line &&
			!completionText.startsWith("\n")
		) {
			finalCompletionText = "\n" + completionText
		}

		// Create completion item
		const item: vscode.InlineCompletionItem = {
			insertText: finalCompletionText,
			range,
			command: {
				command: "kilo-code.ghost.acceptInlineCompletion",
				title: "Accept inline completion",
			},
		}

		return [item]
	}

	public dispose(): void {
		// Cleanup if needed
	}
}
