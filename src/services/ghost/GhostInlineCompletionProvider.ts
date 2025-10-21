import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"
import { GhostServiceSettings } from "@roo-code/types"

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
	private settings: GhostServiceSettings | null = null

	constructor(
		suggestions: GhostSuggestionsState,
		onIntelliSenseDetected?: () => void,
		settings?: GhostServiceSettings | null,
	) {
		this.suggestions = suggestions
		this.onIntelliSenseDetected = onIntelliSenseDetected
		this.settings = settings || null
	}

	/**
	 * Update the suggestions reference
	 */
	public updateSuggestions(suggestions: GhostSuggestionsState): void {
		this.suggestions = suggestions
	}

	/**
	 * Update the settings reference
	 */
	public updateSettings(settings: GhostServiceSettings | null): void {
		this.settings = settings
	}

	/**
	 * Check if a deletion group is placeholder-only and should be treated as addition
	 */
	private isPlaceholderOnlyDeletion(group: GhostSuggestionEditOperation[]): boolean {
		const deleteOps = group.filter((op) => op.type === "-")
		if (deleteOps.length === 0) return false

		const deletedContent = deleteOps
			.map((op) => op.content)
			.join("\n")
			.trim()
		return deletedContent === "<<<AUTOCOMPLETE_HERE>>>"
	}

	/**
	 * Check if a group should be shown based on onlyAdditions setting
	 */
	private shouldShowGroup(groupType: "+" | "/" | "-", group?: GhostSuggestionEditOperation[]): boolean {
		// If onlyAdditions is enabled (default), check what to show
		const onlyAdditions = this.settings?.onlyAdditions ?? true
		if (onlyAdditions) {
			// Always show pure additions
			if (groupType === "+") {
				return true
			}

			// For modifications, allow completions with common prefix
			// This includes both single-line (e.g., "add" → "addNumbers")
			// and multi-line (e.g., "// impl" → "// impl\nfunction...")
			if (groupType === "/" && group) {
				const deleteOps = group.filter((op) => op.type === "-")
				const addOps = group.filter((op) => op.type === "+")

				if (deleteOps.length > 0 && addOps.length > 0) {
					const deletedContent = deleteOps
						.sort((a, b) => a.line - b.line)
						.map((op) => op.content)
						.join("\n")
					const addedContent = addOps
						.sort((a, b) => a.line - b.line)
						.map((op) => op.content)
						.join("\n")

					// If added content starts with deleted content, it's a completion - allow it
					// This handles both single-line and multi-line completions
					if (addedContent.startsWith(deletedContent)) {
						return true
					}
				}
			}

			// Don't show deletions or multi-line modifications
			return false
		}
		// Otherwise show all group types
		return true
	}

	/**
	 * Determine if a group should use inline completion instead of SVG decoration
	 * Centralized logic to ensure consistency
	 */
	public shouldUseInlineCompletion(
		selectedGroup: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		cursorLine: number,
		file: any,
	): boolean {
		// First check if this group type should be shown at all
		// Pass the group so shouldShowGroup can properly evaluate modifications
		if (!this.shouldShowGroup(groupType, selectedGroup)) {
			return false
		}

		// Deletions never use inline
		if (groupType === "-") {
			return false
		}

		// Calculate target line and distance
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		let targetLine: number

		// For modifications, use the deletion line without offsets since that's where the change is happening
		// For additions, apply the offset to account for previously removed lines
		if (groupType === "/") {
			const deleteOp = selectedGroup.find((op: any) => op.type === "-")
			targetLine = deleteOp ? deleteOp.line : selectedGroup[0].line
		} else if (groupType === "+") {
			const firstOp = selectedGroup[0]
			targetLine = firstOp.line + offset.removed
		} else {
			// groupType === "-"
			targetLine = selectedGroup[0].line + offset.added
		}

		const distanceFromCursor = Math.abs(cursorLine - targetLine)

		// Must be within 5 lines
		if (distanceFromCursor > 5) {
			return false
		}

		// For pure additions, use inline
		if (groupType === "+") {
			return true
		}

		// For modifications, check if there's a common prefix or empty deleted content
		const deleteOps = selectedGroup.filter((op) => op.type === "-")
		const addOps = selectedGroup.filter((op) => op.type === "+")

		if (deleteOps.length === 0 || addOps.length === 0) {
			return false
		}

		const deletedContent = deleteOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
		const addedContent = addOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// If deleted content is empty or just the placeholder, treat as pure addition
		const trimmedDeleted = deletedContent.trim()
		if (trimmedDeleted.length === 0 || trimmedDeleted === "<<<AUTOCOMPLETE_HERE>>>") {
			return true
		}

		// Check if this should be treated as addition (LLM wants to add after existing content)
		if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
			return true
		}

		// Check for common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		return commonPrefix.length > 0
	}
	/**
	 * Determine if inline suggestions should be triggered for current state
	 * Returns true if inline completion should be shown
	 */
	public shouldTriggerInline(editor: vscode.TextEditor, suggestions: GhostSuggestionsState): boolean {
		if (!suggestions.hasSuggestions()) {
			return false
		}

		const file = suggestions.getFile(editor.document.uri)
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

		// Use the shouldUseInlineCompletion logic
		return this.shouldUseInlineCompletion(selectedGroup, selectedGroupType, editor.selection.active.line, file)
	}

	/**
	 * Get indices of groups that should be skipped for SVG decorations
	 * Returns array of group indices to skip
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

			// Skip groups that shouldn't be shown based on settings
			if (!this.shouldShowGroup(groupType, group)) {
				skipGroupIndices.push(i)
				continue
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

			// If we're using a synthetic modification group (deletion + addition in separate groups),
			// skip both the deletion group AND the addition group
			if (selectedGroupType === "-" && selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				// If next group is addition and they should be combined, skip both
				if (nextGroupType === "+") {
					const deleteOps = selectedGroup.filter((op: any) => op.type === "-")
					const addOps = nextGroup.filter((op: any) => op.type === "+")

					const deletedContent = deleteOps.map((op: any) => op.content).join("\n")
					const addedContent = addOps.map((op: any) => op.content).join("\n")

					// If they have common prefix or other addition criteria, skip the addition group too
					if (
						addedContent.startsWith(deletedContent) ||
						deletedContent === "<<<AUTOCOMPLETE_HERE>>>" ||
						addedContent.startsWith("\n") ||
						addedContent.startsWith("\r\n")
					) {
						if (!skipGroupIndices.includes(selectedGroupIndex + 1)) {
							skipGroupIndices.push(selectedGroupIndex + 1)
						}
					}
				}
			}

			// IMPORTANT: To prevent showing multiple suggestions simultaneously (inline + SVG),
			// when using inline completion, hide ALL other groups from SVG decorations.
			// This ensures only ONE suggestion is visible at a time (the inline one).
			for (let i = 0; i < groups.length; i++) {
				if (i !== selectedGroupIndex && !skipGroupIndices.includes(i)) {
					skipGroupIndices.push(i)
				}
			}
		}

		return skipGroupIndices
	}

	/**
	 * Find next valid group index that should be shown
	 * Returns the index or null if none found
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

				// Check if this is a valid group to show
				const isPlaceholder = currentGroupType === "-" && this.isPlaceholderOnlyDeletion(currentGroup)
				const shouldShow = this.shouldShowGroup(currentGroupType, currentGroup)

				if (!isPlaceholder && shouldShow) {
					return currentIndex
				}
			}

			// Safety check to avoid infinite loop
			if (currentIndex === startIndex) {
				break
			}
		}

		return null
	}

	/**
	 * Find previous valid group index that should be shown
	 * Returns the index or null if none found
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

				// Check if this is a valid group to show
				const isPlaceholder = currentGroupType === "-" && this.isPlaceholderOnlyDeletion(currentGroup)
				const shouldShow = this.shouldShowGroup(currentGroupType, currentGroup)

				if (!isPlaceholder && shouldShow) {
					return currentIndex
				}
			}

			// Safety check to avoid infinite loop
			if (currentIndex === startIndex) {
				break
			}
		}

		return null
	}

	/**
	 * Select closest valid group after initial selection
	 * Ensures the selected group is valid to show
	 */
	public selectClosestValidGroup(file: any, editor: vscode.TextEditor): void {
		const selectedGroupIndex = file.getSelectedGroup()
		if (selectedGroupIndex === null) {
			return
		}

		const groups = file.getGroupsOperations()
		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		const shouldSkip =
			(selectedGroupType === "-" && this.isPlaceholderOnlyDeletion(selectedGroup)) ||
			!this.shouldShowGroup(selectedGroupType, selectedGroup)

		if (shouldSkip) {
			// Try to find a valid group
			this.findNextValidGroup(file, selectedGroupIndex)
		}
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
	 * Get effective group for inline completion (handles separated deletion+addition groups)
	 */
	private getEffectiveGroup(
		file: any,
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "+" | "/" | "-" } | null {
		if (selectedGroupIndex >= groups.length) return null

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		// Check if this is a modification with empty deletion
		// This happens when on empty line: delete '', add content
		if (selectedGroupType === "/") {
			const deleteOps = selectedGroup.filter((op) => op.type === "-")
			const addOps = selectedGroup.filter((op) => op.type === "+")

			if (deleteOps.length > 0 && addOps.length > 0) {
				const deletedContent = deleteOps
					.map((op) => op.content)
					.join("\n")
					.trim()

				// If deletion is empty, combine all subsequent additions
				if (deletedContent.length === 0 || deletedContent === "<<<AUTOCOMPLETE_HERE>>>") {
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
			}
		}

		// If selected group is deletion, check if we should use associated addition
		if (selectedGroupType === "-") {
			const deleteOps = selectedGroup.filter((op) => op.type === "-")
			const deletedContent = deleteOps
				.map((op) => op.content)
				.join("\n")
				.trim()

			// Case 1: Placeholder-only deletion
			if (deletedContent === "<<<AUTOCOMPLETE_HERE>>>") {
				return this.getNextAdditionGroup(file, groups, selectedGroupIndex)
			}

			// Case 2: Deletion followed by addition - check what type of handling it needs
			if (selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				if (nextGroupType === "+") {
					const addOps = nextGroup.filter((op) => op.type === "+")
					const addedContent = addOps
						.sort((a, b) => a.line - b.line)
						.map((op) => op.content)
						.join("\n")

					// Check if added content starts with deleted content (common prefix scenario)
					if (addedContent.startsWith(deletedContent)) {
						console.log("[InlineCompletion] Common prefix detected, creating synthetic modification group")
						console.log("[InlineCompletion] Deleted:", deletedContent.substring(0, 50))
						console.log("[InlineCompletion] Added:", addedContent.substring(0, 50))
						// Create synthetic modification group for proper common prefix handling
						const syntheticGroup = [...selectedGroup, ...nextGroup]
						return { group: syntheticGroup, type: "/" }
					}

					// Check if this should be treated as addition after existing content
					if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
						return { group: nextGroup, type: "+" }
					}
				}
			}

			return null // Regular deletions use SVG decorations
		}

		// NEW: Check if this is an addition group that should be combined with previous deletion
		// This handles cases where deletion and addition were separated by the grouping logic
		// because their newLine values differed, but they share a common prefix
		if (selectedGroupType === "+" && selectedGroupIndex > 0) {
			const previousGroup = groups[selectedGroupIndex - 1]
			const previousGroupType = file.getGroupType(previousGroup)

			if (previousGroupType === "-") {
				const deleteOps = previousGroup.filter((op: GhostSuggestionEditOperation) => op.type === "-")
				const addOps = selectedGroup.filter((op: GhostSuggestionEditOperation) => op.type === "+")

				const deletedContent = deleteOps
					.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
					.map((op: GhostSuggestionEditOperation) => op.content)
					.join("\n")
				const addedContent = addOps
					.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
					.map((op: GhostSuggestionEditOperation) => op.content)
					.join("\n")

				// Check if they share a common prefix (trimmed to handle trailing whitespace differences)
				const trimmedDeleted = deletedContent.trim()
				const commonPrefix = this.findCommonPrefix(trimmedDeleted, addedContent)

				if (commonPrefix.length > 0 && commonPrefix.length >= trimmedDeleted.length * 0.8) {
					// Create synthetic modification group for proper common prefix handling
					const syntheticGroup = [...previousGroup, ...selectedGroup]
					return { group: syntheticGroup, type: "/" }
				}
			}
		}

		return { group: selectedGroup, type: selectedGroupType }
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
	 * Check if deletion+addition should be treated as pure addition
	 */
	private shouldTreatAsAddition(deletedContent: string, addedContent: string): boolean {
		// Case 1: Added content starts with deleted content
		if (addedContent.startsWith(deletedContent)) {
			// Always return false - let common prefix logic handle this
			// This ensures proper inline completion with suffix only
			return false
		}

		// Case 2: Added content starts with newline - indicates LLM wants to add content after current line
		return addedContent.startsWith("\n") || addedContent.startsWith("\r\n")
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
			// Pure addition - but check if it's really part of a modification (deletion + addition)
			// This happens when onlyAdditions mode skips the deletion group
			const sortedOps = group.sort((a, b) => a.line - b.line)
			const text = sortedOps.map((op) => op.content).join("\n")

			// Check if there's a previous deletion group
			if (selectedGroupIndex > 0) {
				const previousGroup = groups[selectedGroupIndex - 1]
				const previousGroupType = file.getGroupType(previousGroup)

				if (previousGroupType === "-") {
					const deleteOps = previousGroup.filter((op: GhostSuggestionEditOperation) => op.type === "-")
					const deletedContent = deleteOps
						.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
						.map((op: GhostSuggestionEditOperation) => op.content)
						.join("\n")

					// If the entire addition starts with the deletion, strip the common prefix
					if (text.startsWith(deletedContent)) {
						const suffix = text.substring(deletedContent.length)
						// Return the suffix, treating it as a modification
						return { text: suffix, isAddition: false }
					}

					// Check if just the first line of the addition starts with the deletion
					// This handles cases like typing "// " and completing to "// implement..."
					if (sortedOps.length > 0 && sortedOps[0].content.startsWith(deletedContent)) {
						const firstLineSuffix = sortedOps[0].content.substring(deletedContent.length)
						const remainingLines = sortedOps.slice(1).map((op) => op.content)
						const completionText = [firstLineSuffix, ...remainingLines].join("\n")
						// Return as modification so it shows on same line
						return { text: completionText, isAddition: false }
					}
				}
			}

			return { text, isAddition: true }
		}

		// Modification - determine what to show
		const deleteOps = group.filter((op) => op.type === "-")
		const addOps = group.filter((op) => op.type === "+")

		if (deleteOps.length === 0 || addOps.length === 0) {
			return { text: "", isAddition: false }
		}

		const deletedContent = deleteOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
		const addedContent = addOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// Check different scenarios for what to show
		const trimmedDeleted = deletedContent.trim()

		if (trimmedDeleted.length === 0 || trimmedDeleted === "<<<AUTOCOMPLETE_HERE>>>") {
			// Empty or placeholder deletion - show all added content
			return { text: addedContent, isAddition: true }
		}

		if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
			// Should be treated as addition - show appropriate part
			if (addedContent.startsWith(deletedContent)) {
				// Show only new part after existing content
				return { text: addedContent.substring(deletedContent.length), isAddition: false }
			} else if (addedContent.startsWith("\n") || addedContent.startsWith("\r\n")) {
				// Remove leading newline and show rest
				return { text: addedContent.replace(/^\r?\n/, ""), isAddition: true }
			}
		}

		// Regular modification - show suffix after common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		if (commonPrefix.length === 0) {
			return { text: "", isAddition: false } // No common prefix - use SVG decoration
		}

		// Get the suffix for this modification
		const suffix = addedContent.substring(commonPrefix.length)

		// Check if there are subsequent addition groups that should be combined
		// This handles: typing "functio" → complete to "functions\n<function code>"
		if (selectedGroupIndex + 1 < groups.length) {
			const nextGroup = groups[selectedGroupIndex + 1]
			const nextGroupType = file.getGroupType(nextGroup)

			if (nextGroupType === "+") {
				// Combine the suffix with the next additions
				const nextAdditions = nextGroup
					.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
					.map((op: GhostSuggestionEditOperation) => op.content)
					.join("\n")

				return { text: suffix + "\n" + nextAdditions, isAddition: false }
			}
		}

		return { text: suffix, isAddition: false }
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
		// For pure additions, position at the end of the current line
		// (newline prefix will be added later for multi-line content)
		if (isAddition) {
			const currentLineText = document.lineAt(position.line).text
			const insertPosition = new vscode.Position(position.line, currentLineText.length)
			return new vscode.Range(insertPosition, insertPosition)
		}

		// For modifications (common prefix), check if suffix is multi-line
		if (targetLine === position.line) {
			// If completion text is multi-line, start on next line
			if (completionText.includes("\n")) {
				const nextLine = Math.min(position.line + 1, document.lineCount)
				const insertPosition = new vscode.Position(nextLine, 0)
				return new vscode.Range(insertPosition, insertPosition)
			} else {
				// Single-line completion can continue on same line
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

		// Suppress inline completion when IntelliSense is showing suggestions
		// This prevents double-acceptance when Tab is pressed
		// IntelliSense takes priority since it's more specific to what the user typed
		if (context.selectedCompletionInfo) {
			// Notify that IntelliSense is active so we can cancel our suggestions
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

		// Get effective group (handles separation of deletion+addition)
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
		const firstOp = effectiveGroup.group[0]

		// For modifications, use the deletion line without offsets since that's where the change is happening
		// For additions, apply the offset to account for previously removed lines
		const targetLine =
			effectiveGroup.type === "/"
				? (effectiveGroup.group.find((op) => op.type === "-")?.line ?? firstOp.line)
				: effectiveGroup.type === "+"
					? firstOp.line + offset.removed
					: firstOp.line + offset.added

		if (Math.abs(position.line - targetLine) > 5) {
			return undefined // Too far - let decorations handle it
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
		let range = this.getInsertionRange(document, position, targetLine, isAddition, completionText)
		let finalCompletionText = completionText

		// For pure additions, add newline prefix if content is multi-line AND doesn't already start with newline
		if (isAddition && completionText.includes("\n") && !completionText.startsWith("\n")) {
			finalCompletionText = "\n" + completionText
		}
		// For modifications with multi-line suffix, add newline if needed and not already present
		else if (
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
				command: "kilo-code.ghost.applyCurrentSuggestions",
				title: "Accept suggestion",
			},
		}

		return [item]
	}

	public dispose(): void {
		// Cleanup if needed
	}
}
