import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"

export class GhostStrategy {
	getSystemPrompt(customInstructions: string = "") {
		const basePrompt = `
You are an expert-level AI pair programmer.
Your single most important goal is to help the user move forward with their current coding task by correctly interpreting their intent from their recent changes.
You are a proactive collaborator who completes in-progress work and cleans up the consequences of removals, refactors and incomplete code.
When you see incomplete code, be creative and helpful - infer the user's intent from context clues like variable names, existing patterns, and the surrounding code. Always complete what they started rather than suggesting deletion.

## Core Directives

1. **First, Analyze the Change Type:** Your first step is to analyze the \`Recent Changes (Diff)\`. Is the user primarily **adding/modifying** code or **deleting** code? This determines your entire strategy.

2. **Recognize User Intent:** The user's changes are intentional. If they rename a variable, they want that rename propagated. If they delete code, they want related code cleaned up. **Never revert the user's changes** - instead, help them complete what they started.

3. **Analyze Full Context:** Scrutinize all provided information:
    
	**Recent Changes (Diff):** This is your main clue to the user's intent.
		
	**Rule for ADDITIONS/MODIFICATIONS:**
		* **If the diff shows newly added but incomplete code**, your primary intent is **CONSTRUCTIVE COMPLETION**. Be creative and helpful!
		* **For incomplete functions/variables** (e.g., \`const onButtonHoldClick = \`), infer the likely purpose from the name and context, then complete it with a reasonable implementation. For example, "onButtonHoldClick" suggests a hold/long-press handler.
		* **If the diff shows a variable/function/identifier being renamed** (e.g., \`count\` changed to \`sum\`), your task is to **propagate the rename** throughout the document. Update all references to use the new name. The diagnostics showing "cannot find name 'oldName'" are clues to find all places that need updating.
		* Assume temporary diagnostics (like 'unused variable' or 'missing initializer' on a new line) are signs of work-in-progress.
		* Your task is to **complete the feature**. For an unused variable, find a logical place to use it. For an incomplete statement, finish it. **Never suggest deleting the user's new work or reverting their changes. Always help them move forward.**

	**Rule for DELETIONS:**
    	* **If the diff shows a line was deleted**, your primary intent is **LOGICAL REMOVAL**.
    	* Assume the user wants to remove the functionality associated with the deleted code.
    	* The new diagnostics (like "'variable' is not defined") are not errors to be fixed by re-adding code. They are your guide to find all the **obsolete code that now also needs to be deleted.**
    	* Your task is to **propagate the deletion**. Remove all usages of the deleted variables, functions, or components.

  * **User Focus (Cursor/Selection):** This indicates the immediate area of focus.
    
	* **Full Document & File Path:** Scan the entire document and use its file path to understand its place in the project.

4.  **Strict Search and Replace XML Output Format:** Your entire response **MUST** use the following XML format for each change:
    * Each change must be wrapped in <change> blocks
    * Use <search> tags to identify the exact code block to be replaced
    * Use <replace> tags to provide the replacement content
    * Wrap code content in CDATA sections to handle special characters and multi-line code properly
    * You can provide multiple <change> blocks for multiple modifications
    * **IMPORTANT: Format as single-line XML with NO line breaks or whitespace between tags**
    * **Example:**
      \`\`\`xml
      <change><search><![CDATA[const oldFunction = () => { console.log("old"); }]]></search><replace><![CDATA[const newFunction = () => { console.log("new"); return true; }]]></replace></change>
      \`\`\`
    * **Critical Requirements:**
      - Do not include any conversational text, explanations, or any text outside of this required XML format
      - The search content must match the existing code exactly, including whitespace and indentation
      - **IMPORTANT: Always include COMPLETE code blocks in search patterns. Never use partial matches like single lines from multi-line functions, classes, or objects. Include the entire construct from opening to closing braces/brackets.**
      - **For functions: Include the entire function from declaration to closing brace**
      - **For objects/classes: Include the entire structure from opening to closing brace**
      - **For multi-line statements: Include all lines that form the complete logical unit**
      - Each search block must contain exact text that exists in the current document
      - Use CDATA sections to properly handle multi-line code blocks and special characters
      - Multiple changes should use separate <change> blocks, not nested within a single block
      - **Do not add extra whitespace or line breaks between XML tags; tags should be directly adjacent**
      - Only the content inside CDATA sections should contain line breaks, spaces, and tabs as needed for code formatting
`
		return customInstructions ? `${basePrompt}${customInstructions}` : basePrompt
	}

	private getBaseSuggestionPrompt() {
		return `\
# Task
Analyze my recent code modifications to infer my underlying intent. Based on that intent, identify all related code that is now obsolete or inconsistent and provide targeted changes using the XML search-and-replace format.

# Instructions
1.  **Infer Intent:** First, analyze the \`Recent Changes (Diff)\` to form a hypothesis about my goal. If I've started writing something incomplete, infer what I'm trying to achieve.
2.  **Be Creative and Helpful:** For incomplete code (like \`const onButtonHoldClick = \`), use context clues to complete it intelligently. Consider the name, surrounding code, and common patterns.
3.  **Identify All Impacts:** Based on the inferred intent, scan the \`Current Document\` to find every piece of code that is affected. This includes component usages, variables, and related text or comments that are now obsolete.
4.  **Fix Document Diagnostics:** If the \`Current Document\` has diagnostics, assume they are now obsolete due to the changes. Remove or update them as necessary.
5.  **Generate XML Search-and-Replace Response:** Your response must use the XML format with <change>, <search>, and <replace> tags. Each <search> block must contain exact text that exists in the current document, and each <replace> block must contain the updated code. Use CDATA sections to handle multi-line code properly. Provide multiple <change> blocks if multiple modifications are needed.

# Context
`
	}

	private getRecentUserActions(context: GhostSuggestionContext) {
		if (!context.recentOperations || context.recentOperations.length === 0) {
			return ""
		}
		let result = `**Recent User Actions:**\n\n`
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

	private getUserFocusPrompt(context: GhostSuggestionContext) {
		const { range } = context
		if (!range) {
			return ""
		}
		const cursorLine = range.start.line + 1 // 1-based line number
		const cursorCharacter = range.start.character + 1 // 1-based character position
		return `**User Focus:**
Cursor Position: Line ${cursorLine}, Character ${cursorCharacter}`
	}

	private getUserSelectedTextPrompt(context: GhostSuggestionContext) {
		const { document, range } = context
		if (!document || !range) {
			return ""
		}
		const selectedText = document.getText(range)
		const languageId = document.languageId
		return `**Selected Text:**
\`\`\`${languageId}
${selectedText}
\`\`\``
	}

	private getUserCurrentDocumentPrompt(context: GhostSuggestionContext) {
		const { document } = context
		if (!document) {
			return ""
		}
		const documentUri = document.uri.toString()
		const languageId = document.languageId
		return `**Current Document: ${documentUri}**
\`\`\`${languageId}
${document.getText()}
\`\`\``
	}

	private getUserInputPrompt(context: GhostSuggestionContext) {
		const { userInput } = context
		if (!userInput) {
			return ""
		}
		return `**User Input:**
\`\`\`
${userInput}
\`\`\``
	}

	private getASTInfoPrompt(context: GhostSuggestionContext) {
		if (!context.documentAST) {
			return ""
		}

		let astInfo = `**AST Information:**\n`

		// Add language information
		astInfo += `Language: ${context.documentAST.language}\n\n`

		// If we have a cursor position with an AST node, include that information
		if (context.rangeASTNode) {
			const node = context.rangeASTNode
			astInfo += `Current Node Type: ${node.type}\n`
			astInfo += `Current Node Text: ${node.text.substring(0, 100)}${node.text.length > 100 ? "..." : ""}\n`

			// Include parent context if available
			if (node.parent) {
				astInfo += `Parent Node Type: ${node.parent.type}\n`

				// Include siblings for context
				const siblings = []
				let sibling = node.previousSibling
				while (sibling && siblings.length < 3) {
					siblings.unshift(
						`${sibling.type}: ${sibling.text.substring(0, 30)}${sibling.text.length > 30 ? "..." : ""}`,
					)
					sibling = sibling.previousSibling
				}

				sibling = node.nextSibling
				while (sibling && siblings.length < 5) {
					siblings.push(
						`${sibling.type}: ${sibling.text.substring(0, 30)}${sibling.text.length > 30 ? "..." : ""}`,
					)
					sibling = sibling.nextSibling
				}

				if (siblings.length > 0) {
					astInfo += `\nSurrounding Nodes:\n`
					siblings.forEach((s, i) => {
						astInfo += `${i + 1}. ${s}\n`
					})
				}
			}

			// Include children for context
			const children = []
			for (let i = 0; i < node.childCount && children.length < 5; i++) {
				const child = node.child(i)
				if (child) {
					children.push(`${child.type}: ${child.text.substring(0, 30)}${child.text.length > 30 ? "..." : ""}`)
				}
			}

			if (children.length > 0) {
				astInfo += `\nChild Nodes:\n`
				children.forEach((c, i) => {
					astInfo += `${i + 1}. ${c}\n`
				})
			}
		}

		return astInfo
	}

	private getDiagnosticsPrompt(context: GhostSuggestionContext) {
		if (!context.diagnostics || context.diagnostics.length === 0) {
			return ""
		}

		let diagnosticsInfo = `**Document Diagnostics:**\n`

		// Group diagnostics by severity
		const errorDiagnostics = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
		const warningDiagnostics = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning)
		const infoDiagnostics = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Information)
		const hintDiagnostics = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Hint)

		// Format errors
		if (errorDiagnostics.length > 0) {
			diagnosticsInfo += `\nErrors (${errorDiagnostics.length}):\n`
			errorDiagnostics.forEach((diagnostic, index) => {
				const line = diagnostic.range.start.line + 1 // 1-based line number
				const character = diagnostic.range.start.character + 1 // 1-based character position
				diagnosticsInfo += `${index + 1}. Line ${line}, Char ${character}: ${diagnostic.message}\n`
			})
		}

		// Format warnings
		if (warningDiagnostics.length > 0) {
			diagnosticsInfo += `\nWarnings (${warningDiagnostics.length}):\n`
			warningDiagnostics.forEach((diagnostic, index) => {
				const line = diagnostic.range.start.line + 1 // 1-based line number
				const character = diagnostic.range.start.character + 1 // 1-based character position
				diagnosticsInfo += `${index + 1}. Line ${line}, Char ${character}: ${diagnostic.message}\n`
			})
		}

		// Format information
		if (infoDiagnostics.length > 0) {
			diagnosticsInfo += `\nInformation (${infoDiagnostics.length}):\n`
			infoDiagnostics.forEach((diagnostic, index) => {
				const line = diagnostic.range.start.line + 1 // 1-based line number
				const character = diagnostic.range.start.character + 1 // 1-based character position
				diagnosticsInfo += `${index + 1}. Line ${line}, Char ${character}: ${diagnostic.message}\n`
			})
		}

		// Format hints
		if (hintDiagnostics.length > 0) {
			diagnosticsInfo += `\nHints (${hintDiagnostics.length}):\n`
			hintDiagnostics.forEach((diagnostic, index) => {
				const line = diagnostic.range.start.line + 1 // 1-based line number
				const character = diagnostic.range.start.character + 1 // 1-based character position
				diagnosticsInfo += `${index + 1}. Line ${line}, Char ${character}: ${diagnostic.message}\n`
			})
		}

		return diagnosticsInfo
	}

	getSuggestionPrompt(context: GhostSuggestionContext) {
		const sections = [
			this.getBaseSuggestionPrompt(),
			this.getUserInputPrompt(context),
			this.getRecentUserActions(context),
			this.getUserFocusPrompt(context),
			this.getUserSelectedTextPrompt(context),
			this.getASTInfoPrompt(context),
			this.getDiagnosticsPrompt(context),
			this.getUserCurrentDocumentPrompt(context),
		]

		return `[INST]
${sections.filter(Boolean).join("\n\n")}
[/INST]
`
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
	 */
	private findBestMatch(content: string, searchPattern: string): number {
		// First try exact match
		let index = content.indexOf(searchPattern)
		if (index !== -1) {
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

		// NEW: Enhanced validation for partial matches
		// Before doing fuzzy matching, check if this might be a partial match of a larger construct
		if (this.isPotentialPartialMatch(content, searchPattern)) {
			console.warn(
				"Potential partial match detected. Search pattern might be incomplete:",
				searchPattern.substring(0, 100),
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

		// Extract all <change> blocks from the response
		// Updated regex to handle both single-line XML format and traditional format with whitespace
		const changeRegex =
			/<change>\s*<search>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/search>\s*<replace>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/replace>\s*<\/change>/g
		const changes: Array<{ search: string; replace: string }> = []

		let match
		while ((match = changeRegex.exec(response)) !== null) {
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
				// Handle the case where search pattern ends with newline but we need to preserve additional whitespace
				let endIndex = searchIndex + change.search.length
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
