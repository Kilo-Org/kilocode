import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"

// Add a special marker at the cursor position to help the AI focus on autocomplete
const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

export class GhostStrategy {
	/**
	 * Returns the universal system prompt that defines the AI's role, capabilities,
	 * and strict output format. It's designed for broad model compatibility.
	 */
	getSystemPrompt(customInstructions: string = ""): string {
		const basePrompt = `
Task Definition
You are an expert AI programming assistant. Your task is to analyze the provided code context and user changes to infer the user's intent. Based on that intent, generate the precise code modifications needed to complete their work.

---

Required Output Format (CRITICAL)
You must adhere strictly to the following XML format. Any deviation will cause the tool to fail.

1.  **Single-Line XML**: The entire response must be a single, continuous line of XML with no line breaks between tags.
2.  **Change Blocks**: Each distinct modification must be wrapped in its own \`<change>...\</change>\` tags.
3.  **Search and Replace**: Inside each \`<change>\` block, use \`<search>\` for the code to be replaced and \`<replace>\` for the new code.
4.  **Exact Match**: The content in the \`<search>\` tag must exactly match a section of the current code, including all indentation and whitespace.
5.  **CDATA Wrappers**: All code inside \`<search>\` and \`<replace>\` tags must be wrapped in \`<![CDATA[...]]>\`.
6.  **Complete Blocks**: Always search for and replace complete logical code blocks (e.g., entire functions, classes, or multi-line statements). Do not target partial or single lines from a larger block.
7.  **No Overlapping Changes**: Never generate multiple \`<change>\` blocks that modify the same or overlapping lines of code. If several edits are needed in one function, you must create a single \`<change>\` block that replaces the entire original function with its new version.`

		// Append any dynamic custom instructions if provided
		return customInstructions ? `${basePrompt}\n\n---\n\n${customInstructions}` : basePrompt
	}

	/**
	 * Provides the static introductory part of the user-facing prompt.
	 */
	private getBaseSuggestionPrompt(): string {
		return `
## Context
`
	}

	/**
	 * Provides the static instructions that guide the model's reasoning process.
	 */
	private getInstructionsPrompt(): string {
		return `
---

## Instructions

1.  **Analyze Intent**: Your primary goal is to understand the user's intent from the \`Recent User Actions\`.
	   * **If code was added or modified**, assume the user wants to build upon it. Your task is to complete the feature or propagate the change (like a rename).
	   * **If code was deleted**, assume the user wants to remove functionality. Your task is to find and delete all related, now-obsolete code.
	   * **If a cursor marker (<<<AUTOCOMPLETE_HERE>>>) is present**, focus on intelligently completing the code from that position, considering the surrounding context and typical coding patterns.

2.  **Plan Changes**: Based on the intent, examine the \`Full Code\` and \`Active Diagnostics\`. The diagnostics are clues to what is now inconsistent or incomplete. Identify all code blocks that need to be added, removed, or updated.

3.  **Generate Response**: Produce a response containing only the XML-formatted changes. Do not include any explanations, apologies, or conversational text.
`
	}

	private getFilePathPrompt(context: GhostSuggestionContext): string {
		return context.document ? `* **File Path**: \`${context.document.uri.toString()}\`` : ""
	}

	private getRecentUserActions(context: GhostSuggestionContext) {
		if (!context.recentOperations || context.recentOperations.length === 0) {
			return ""
		}
		let result = `* **Recent User Actions:**\n`
		let actionIndex = 1

		// Flatten all actions from all groups and list them individually
		context.recentOperations.forEach((action) => {
			result += `${actionIndex}. ${action.description}\n`
			if (action.content) {
				result += `\`\`\`\n${action.content}\n\`\`\`\n`
			}
			result += `\n`
			actionIndex++
		})

		return result
	}

	private getUserFocusPrompt(context: GhostSuggestionContext): string {
		if (!context.range) return ""
		const { start } = context.range
		return `* **User Focus**: Cursor at Line ${start.line + 1}, Character ${start.character + 1}`
	}

	private getUserSelectedTextPrompt(context: GhostSuggestionContext): string {
		if (!context.document || !context.range || context.range.isEmpty) return ""
		const selectedText = context.document.getText(context.range)
		return `* **Selected Text**:\n    \`\`\`${context.document.languageId}\n${selectedText}\n    \`\`\``
	}

	private getUserInputPrompt(context: GhostSuggestionContext): string {
		if (!context.userInput) return ""
		return `* **User Query**: "${context.userInput}"`
	}

	private getASTInfoPrompt(context: GhostSuggestionContext): string {
		if (!context.rangeASTNode) return ""
		const node = context.rangeASTNode
		let astInfo = `* **AST Context**:\n`
		astInfo += `    * **Current Node**: \`${node.type}\`\n`
		if (node.parent) {
			astInfo += `    * **Parent Node**: \`${node.parent.type}\`\n`
		}
		return astInfo
	}

	private getDiagnosticsPrompt(context: GhostSuggestionContext): string {
		if (!context.diagnostics || context.diagnostics.length === 0) return ""

		const formattedDiagnostics = context.diagnostics
			.map((d) => {
				const severity = vscode.DiagnosticSeverity[d.severity]
				const line = d.range.start.line + 1
				return `        * **${severity}**: ${d.message} (Line ${line})`
			})
			.join("\n")

		return `* **Active Diagnostics**:\n${formattedDiagnostics}`
	}

	private getUserCurrentDocumentPrompt(context: GhostSuggestionContext): string {
		if (!context.document) return ""

		const fullText = context.document.getText()

		// If we have a cursor position, split the document and add a marker
		if (context.range) {
			const cursorOffset = context.document.offsetAt(context.range.start)
			const beforeCursor = fullText.substring(0, cursorOffset)
			const afterCursor = fullText.substring(cursorOffset)

			return `
---

## Full Code

**Note**: The cursor is currently at the position marked with \`${CURSOR_MARKER}\`. Focus on completing code from this position based on the context and user intent.

\`\`\`${context.document.languageId}
${beforeCursor}${CURSOR_MARKER}${afterCursor}
\`\`\``
		}

		// Fallback to full document if no cursor position
		return `
---

## Full Code

\`\`\`${context.document.languageId}
${fullText}
\`\`\``
	}

	getSuggestionPrompt(context: GhostSuggestionContext): string {
		const contextSections = [
			this.getFilePathPrompt(context),
			this.getRecentUserActions(context),
			this.getUserInputPrompt(context),
			this.getUserFocusPrompt(context),
			this.getUserSelectedTextPrompt(context),
			this.getASTInfoPrompt(context),
			this.getDiagnosticsPrompt(context),
		]

		const promptParts = [
			this.getBaseSuggestionPrompt(),
			contextSections.filter(Boolean).join("\n"),
			this.getUserCurrentDocumentPrompt(context),
			this.getInstructionsPrompt(),
		]

		return promptParts.filter(Boolean).join("\n")
	}

	/**
	 * Check if the search pattern might be a partial match of a larger code construct
	 */
	private isPotentialPartialMatch(content: string, searchPattern: string): boolean {
		const trimmedPattern = searchPattern.trim()

		// Check for common patterns that suggest partial matches
		const partialPatterns = [
			/^(const|let|var|function|class|interface|type)\s+\w+\s*[=:]?\s*$/, // Variable/function declarations without body
			/^[^{]*\{\s*$/, // Opening brace without closing
			/^\s*[^}]*$/, // Content without closing brace when it should have one
			/^[^(]*\([^)]*$/, // Opening parenthesis without closing
			/^[^[]*\[[^\]]*$/, // Opening bracket without closing
		]

		return partialPatterns.some((pattern) => pattern.test(trimmedPattern))
	}

	/**
	 * Validate if a match represents a complete code construct
	 */
	private isCompleteMatch(
		content: string,
		matchIndex: number,
		matchLength: number,
		originalPattern: string,
	): boolean {
		const matchedText = content.substring(matchIndex, matchIndex + matchLength)
		const trimmedMatch = matchedText.trim()
		const trimmedPattern = originalPattern.trim()

		// Check for balanced braces, parentheses, and brackets
		const checkBalance = (open: string, close: string) => {
			const openCount = (trimmedMatch.match(new RegExp(`\\${open}`, "g")) || []).length
			const closeCount = (trimmedMatch.match(new RegExp(`\\${close}`, "g")) || []).length
			return openCount === closeCount
		}

		if (trimmedPattern.includes("{") || trimmedPattern.includes("}")) {
			if (!checkBalance("{", "}")) return false
		}
		if (trimmedPattern.includes("(") || trimmedPattern.includes(")")) {
			if (!checkBalance("(", ")")) return false
		}
		if (trimmedPattern.includes("[") || trimmedPattern.includes("]")) {
			if (!checkBalance("[", "]")) return false
		}

		return true
	}

	/**
	 * Find the best match for search content in the document, handling whitespace differences
	 * @param content The document content to search in
	 * @param searchPattern The pattern to search for
	 * @returns The index of the best match, or -1 if no suitable match is found
	 */
	private findBestMatch(content: string, searchPattern: string): number {
		// Validate inputs
		if (!content || !searchPattern) {
			console.warn("findBestMatch: Invalid input - content or searchPattern is empty")
			return -1
		}

		// Log search attempt for debugging
		const searchPreview = searchPattern.substring(0, 50).replace(/\n/g, "\\n")
		console.debug(`Searching for pattern: "${searchPreview}${searchPattern.length > 50 ? "..." : ""}"`)

		// First try exact match
		let index = content.indexOf(searchPattern)
		if (index !== -1) {
			console.debug(`Found exact match at index ${index}`)
			return index
		}

		// Handle the case where search pattern has trailing whitespace that might not match exactly
		// This is common when the search pattern ends with a newline but the content has additional empty lines
		if (searchPattern.endsWith("\n")) {
			// Try matching without the trailing newline, then check if we can find it in context
			const searchWithoutTrailingNewline = searchPattern.slice(0, -1)
			index = content.indexOf(searchWithoutTrailingNewline)
			if (index !== -1) {
				// Check if the character after the match is a newline or end of string
				const afterMatchIndex = index + searchWithoutTrailingNewline.length
				if (afterMatchIndex >= content.length || content[afterMatchIndex] === "\n") {
					console.debug(`Found match without trailing newline at index ${index}`)
					return index
				}
			}
		}

		// Normalize whitespace for both content and search pattern
		const normalizeWhitespace = (text: string): string => {
			return text
				.replace(/\r\n/g, "\n") // Normalize line endings
				.replace(/\r/g, "\n") // Handle old Mac line endings
				.replace(/\t/g, "    ") // Convert tabs to spaces
				.replace(/[ \t]+$/gm, "") // Remove trailing whitespace from each line
		}

		const normalizedContent = normalizeWhitespace(content)
		const normalizedSearch = normalizeWhitespace(searchPattern)

		// Try normalized match
		index = normalizedContent.indexOf(normalizedSearch)
		if (index !== -1) {
			// Map back to original content position
			return this.mapNormalizedToOriginalIndex(content, normalizedContent, index)
		}

		// Try trimmed search (remove leading/trailing whitespace)
		const trimmedSearch = searchPattern.trim()
		if (trimmedSearch !== searchPattern) {
			index = content.indexOf(trimmedSearch)
			if (index !== -1) {
				return index
			}
		}

		// Enhanced validation for partial matches
		// Before doing fuzzy matching, check if this might be a partial match of a larger construct
		if (this.isPotentialPartialMatch(content, searchPattern)) {
			const patternPreview = searchPattern.substring(0, 100).replace(/\n/g, "\\n")
			console.warn(
				`Potential partial match detected. Search pattern might be incomplete: "${patternPreview}${searchPattern.length > 100 ? "..." : ""}"`,
			)
			console.warn(
				"Hint: Ensure the search pattern includes complete code blocks (e.g., full functions, classes)",
			)
			return -1 // Reject partial matches that could cause duplication
		}

		// Try fuzzy matching with flexible whitespace (only if not a potential partial match)
		const flexiblePattern = searchPattern
			.replace(/\s+/g, "\\s+") // Replace any whitespace sequence with flexible regex
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape regex special characters except our whitespace

		try {
			const regex = new RegExp(flexiblePattern, "g")
			const match = regex.exec(content)
			if (match) {
				// Additional validation: check if this match is part of a larger construct
				if (this.isCompleteMatch(content, match.index, match[0].length, searchPattern)) {
					return match.index
				}
			}
		} catch (e) {
			// Regex failed, continue with other methods
		}

		// Last resort: try to find the first few words of the search pattern
		const words = searchPattern.trim().split(/\s+/).slice(0, 3)
		if (words.length > 0) {
			const partialPattern = words.join("\\s+")
			try {
				const regex = new RegExp(partialPattern, "g")
				const match = regex.exec(content)
				if (match) {
					return match.index
				}
			} catch (e) {
				// Regex failed
			}
		}

		console.debug("No suitable match found for the search pattern")
		return -1 // No match found
	}

	/**
	 * Map an index from normalized content back to the original content
	 */
	private mapNormalizedToOriginalIndex(
		originalContent: string,
		normalizedContent: string,
		normalizedIndex: number,
	): number {
		let originalIndex = 0
		let normalizedPos = 0

		while (normalizedPos < normalizedIndex && originalIndex < originalContent.length) {
			const originalChar = originalContent[originalIndex]
			const normalizedChar = normalizedContent[normalizedPos]

			if (originalChar === normalizedChar) {
				originalIndex++
				normalizedPos++
			} else {
				// Handle whitespace normalization differences
				if (/\s/.test(originalChar)) {
					originalIndex++
					// Skip ahead in original until we find non-whitespace or match normalized
					while (originalIndex < originalContent.length && /\s/.test(originalContent[originalIndex])) {
						originalIndex++
					}
					if (normalizedPos < normalizedContent.length && /\s/.test(normalizedChar)) {
						normalizedPos++
					}
				} else {
					// Characters don't match, this shouldn't happen with proper normalization
					originalIndex++
					normalizedPos++
				}
			}
		}

		return originalIndex
	}

	private async parseSearchAndReplaceFormat(
		response: string,
		context: GhostSuggestionContext,
	): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		const filteredResponse = response.replaceAll(CURSOR_MARKER, "")

		// Extract all <change> blocks from the response
		// Updated regex to handle both single-line XML format and traditional format with whitespace
		const changeRegex =
			/<change>\s*<search>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/search>\s*<replace>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/replace>\s*<\/change>/g
		const changes: Array<{ search: string; replace: string }> = []

		let match
		while ((match = changeRegex.exec(filteredResponse)) !== null) {
			const searchContent = match[1]
			const replaceContent = match[2]
			changes.push({ search: searchContent, replace: replaceContent })
		}
		if (changes.length === 0) {
			return suggestions
		}

		// Process changes for the current document
		const document = context.document
		const currentContent = document.getText()
		let modifiedContent = currentContent

		// Apply changes in reverse order to maintain line numbers
		const appliedChanges: Array<{
			searchContent: string
			replaceContent: string
			startIndex: number
			endIndex: number
		}> = []

		for (const change of changes) {
			const searchIndex = this.findBestMatch(modifiedContent, change.search)
			if (searchIndex !== -1) {
				// Check for overlapping changes before applying
				const endIndex = searchIndex + change.search.length
				const hasOverlap = appliedChanges.some((existingChange) => {
					// Check if ranges overlap
					const existingStart = existingChange.startIndex
					const existingEnd = existingChange.endIndex
					return searchIndex < existingEnd && endIndex > existingStart
				})

				if (hasOverlap) {
					console.warn("Skipping overlapping change:", change.search.substring(0, 50))
					continue // Skip this change to avoid duplicates
				}

				// Handle the case where search pattern ends with newline but we need to preserve additional whitespace
				let adjustedReplaceContent = change.replace

				// If the search pattern ends with a newline, check if there are additional empty lines after it
				if (change.search.endsWith("\n")) {
					let nextCharIndex = endIndex
					let extraNewlines = ""

					// Count consecutive newlines after the search pattern
					while (nextCharIndex < modifiedContent.length && modifiedContent[nextCharIndex] === "\n") {
						extraNewlines += "\n"
						nextCharIndex++
					}

					// If we found extra newlines, preserve them by adding them to the replacement
					if (extraNewlines.length > 0) {
						// Only add the extra newlines if the replacement doesn't already end with enough newlines
						if (!adjustedReplaceContent.endsWith("\n" + extraNewlines)) {
							adjustedReplaceContent = adjustedReplaceContent.trimEnd() + "\n" + extraNewlines
						}
					}
				}

				appliedChanges.push({
					searchContent: change.search,
					replaceContent: adjustedReplaceContent,
					startIndex: searchIndex,
					endIndex: endIndex,
				})
			}
		}

		// Sort by start index in descending order to apply changes from end to beginning
		appliedChanges.sort((a, b) => b.startIndex - a.startIndex)

		// Apply the changes
		for (const change of appliedChanges) {
			modifiedContent =
				modifiedContent.substring(0, change.startIndex) +
				change.replaceContent +
				modifiedContent.substring(change.endIndex)
		}

		// Generate diff between original and modified content
		const relativePath = vscode.workspace.asRelativePath(document.uri, false)
		const patch = structuredPatch(relativePath, relativePath, currentContent, modifiedContent, "", "")

		// Create a suggestion file
		const suggestionFile = suggestions.addFile(document.uri)

		// Process each hunk in the patch
		for (const hunk of patch.hunks) {
			let currentOldLineNumber = hunk.oldStart
			let currentNewLineNumber = hunk.newStart

			// Iterate over each line within the hunk
			for (const line of hunk.lines) {
				const operationType = line.charAt(0) as GhostSuggestionEditOperationType
				const content = line.substring(1)

				switch (operationType) {
					// Case 1: The line is an addition
					case "+":
						suggestionFile.addOperation({
							type: "+",
							line: currentNewLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						// Only increment the new line counter for additions and context lines
						currentNewLineNumber++
						break

					// Case 2: The line is a deletion
					case "-":
						suggestionFile.addOperation({
							type: "-",
							line: currentOldLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						// Only increment the old line counter for deletions and context lines
						currentOldLineNumber++
						break

					// Case 3: The line is unchanged (context)
					default:
						// For context lines, we increment both counters
						currentOldLineNumber++
						currentNewLineNumber++
						break
				}
			}
		}

		suggestions.sortGroups()
		console.log("suggestionFile", suggestionFile.getGroupsOperations())
		return suggestions
	}

	async parseResponse(response: string, context: GhostSuggestionContext): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// First, try to parse as search-and-replace XML format
		if (response.includes("<change>") && response.includes("<search>") && response.includes("<replace>")) {
			return await this.parseSearchAndReplaceFormat(response, context)
		}

		// Try to parse as code block format (filename followed by code block)
		if (response.includes("```")) {
			return await this.parseCodeBlockFormat(response, context)
		}

		// No valid format found
		return suggestions
	}

	/**
	 * Parse code block format like:
	 * filename.js
	 * ```js
	 * code content
	 * ```
	 */
	private async parseCodeBlockFormat(
		response: string,
		context: GhostSuggestionContext,
	): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// Extract filename and code block
		const lines = response.split("\n")
		let filename = ""
		let codeContent = ""
		let inCodeBlock = false
		let language = ""

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim()

			// Check for filename (usually first non-empty line)
			if (!filename && line && !line.startsWith("```") && !inCodeBlock) {
				filename = line
				continue
			}

			// Check for code block start
			if (line.startsWith("```")) {
				if (!inCodeBlock) {
					inCodeBlock = true
					language = line.substring(3).trim()
				} else {
					// End of code block
					break
				}
				continue
			}

			// Collect code content
			if (inCodeBlock) {
				codeContent += (codeContent ? "\n" : "") + lines[i]
			}
		}

		if (!codeContent || !context.document) {
			return suggestions
		}

		// Replace the entire document content with the new code
		const document = context.document
		const currentContent = document.getText()

		// Generate diff between original and new content
		const relativePath = vscode.workspace.asRelativePath(document.uri, false)
		const patch = structuredPatch(relativePath, relativePath, currentContent, codeContent, "", "")

		// Create a suggestion file
		const suggestionFile = suggestions.addFile(document.uri)

		// Process each hunk in the patch
		for (const hunk of patch.hunks) {
			let currentOldLineNumber = hunk.oldStart
			let currentNewLineNumber = hunk.newStart

			// Iterate over each line within the hunk
			for (const line of hunk.lines) {
				const operationType = line.charAt(0) as GhostSuggestionEditOperationType
				const content = line.substring(1)

				switch (operationType) {
					// Case 1: The line is an addition
					case "+":
						suggestionFile.addOperation({
							type: "+",
							line: currentNewLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						// Only increment the new line counter for additions and context lines
						currentNewLineNumber++
						break

					// Case 2: The line is a deletion
					case "-":
						suggestionFile.addOperation({
							type: "-",
							line: currentOldLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						// Only increment the old line counter for deletions and context lines
						currentOldLineNumber++
						break

					// Case 3: The line is unchanged (context)
					default:
						// For context lines, we increment both counters
						currentOldLineNumber++
						currentNewLineNumber++
						break
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}
}
