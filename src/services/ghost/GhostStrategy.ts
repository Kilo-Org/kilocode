import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostDocumentStore } from "./GhostDocumentStore"

export class GhostStrategy {
	getSystemPrompt(customInstructions: string = "") {
		const basePrompt = `\
You are an expert-level AI pair programmer. Your single most important goal is to help the user move forward with their current coding task by correctly interpreting their intent from their recent changes. You are a proactive collaborator who completes in-progress work and cleans up the consequences of removals.

## Core Directives

1.  **First, Analyze the Change Type:** Your first step is to analyze the \`Recent Changes (Diff)\`. Is the user primarily **adding/modifying** code or **deleting** code? This determines your entire strategy.

2.  **Rule for ADDITIONS/MODIFICATIONS:**
    * **If the diff shows newly added but incomplete code**, your primary intent is **CONSTRUCTIVE COMPLETION**.
    * Assume temporary diagnostics (like 'unused variable' or 'missing initializer' on a new line) are signs of work-in-progress.
    * Your task is to **complete the feature**. For an unused variable, find a logical place to use it. For an incomplete statement, finish it. **Do not suggest deleting the user's new work.**

3.  **Rule for DELETIONS:**
    * **If the diff shows a line was deleted**, your primary intent is **LOGICAL REMOVAL**.
    * Assume the user wants to remove the functionality associated with the deleted code.
    * The new diagnostics (like "'variable' is not defined") are not errors to be fixed by re-adding code. They are your guide to find all the **obsolete code that now also needs to be deleted.**
    * Your task is to **propagate the deletion**. Remove all usages of the deleted variables, functions, or components.

4.  **Strict Output Format:** Your response MUST be only the file path and the complete code block. No explanations.`

		return customInstructions ? `${basePrompt}${customInstructions}` : basePrompt
	}

	private getBaseSuggestionPrompt() {
		return `\
# Task
You are my expert pair programmer. Analyze my \`Recent Changes (Diff)\` to determine if I am adding or deleting code, then help me complete my task.

# Instructions
1.  **Identify Intent from Diff:** First, look at the \`diff\`.
    * **If I added code:** My intent is to build a new feature. Help me complete it. Use the \`Document Diagnostics\` as a guide to what needs finishing. **Complete my code, don't delete it.**
    * **If I deleted code:** My intent is to remove a feature. Help me clean it up. Use the \`Document Diagnostics\` to find all the leftover code (usages of variables, components, etc.) that you should **also delete**. **Do not add the code back.**

2.  **Generate Full File:** Based on the correct intent, generate the complete, updated file content. Start with the \`File Path\` and then the code block.

# Context

`
	}

	private getRecentUserActions(context: GhostSuggestionContext) {
		if (!context.recentOperations || context.recentOperations.length === 0) {
			return ""
		}
		let result = `**Recent User Actions:**\n\n`
		context.recentOperations.forEach((group, index) => {
			result += `${index + 1}. **${group.summary}**\n`
			group.actions.forEach((action) => {
				const lineInfo = action.lineRange ? ` (lines ${action.lineRange.start}-${action.lineRange.end})` : ""
				result += `   - ${action.description}${lineInfo}\n`
			})

			result += "\n"
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

	async parseResponse(response: string, context: GhostSuggestionContext): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// Check if the response is in the new format (file path + code block)
		const fullContentMatch = response.match(/^(.+?)\r?\n```[\w-]*\r?\n([\s\S]+?)```/m)

		console.log("fullContentMatch", fullContentMatch)

		// If the response is in the new format
		if (fullContentMatch) {
			// Extract file path and new content
			const [_, filePath, newContent] = fullContentMatch

			// Process the new format
			return await this.processFullContentFormat(filePath, newContent, context)
		}

		// Check if the response is in the old diff format
		if (response.includes("--- a/") && response.includes("+++ b/")) {
			return await this.processDiffFormat(response, context)
		}

		// No valid format found
		return suggestions
	}

	private async processFullContentFormat(
		filePath: string,
		newContent: string,
		context: GhostSuggestionContext,
	): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// Clean up the file path (remove any extra quotes or spaces)
		const cleanedFilePath = filePath.trim()

		// Create a URI for the file
		const fileUri = cleanedFilePath.startsWith("file://")
			? vscode.Uri.parse(cleanedFilePath)
			: vscode.Uri.parse(`file://${cleanedFilePath}`)

		// Try to find the matching document in the context
		const openFiles = context.openFiles || []
		const matchingDocument = openFiles.find(
			(doc) =>
				vscode.workspace.asRelativePath(doc.uri, false) === cleanedFilePath ||
				doc.uri.toString() === fileUri.toString(),
		)

		let documentToUse: vscode.TextDocument | undefined
		let uriToUse: vscode.Uri = fileUri

		if (matchingDocument) {
			documentToUse = matchingDocument
			uriToUse = matchingDocument.uri
		} else {
			// If we couldn't find a matching document, try to open the document
			try {
				documentToUse = await vscode.workspace.openTextDocument(fileUri)
			} catch (error) {
				console.error(`Error opening document ${cleanedFilePath}:`, error)
				return suggestions // Return empty suggestions if we can't open the document
			}
		}

		if (!documentToUse) {
			return suggestions // Return empty suggestions if we can't find or open the document
		}

		// Get the current content of the file
		const currentContent = documentToUse.getText()

		// Generate a diff between the current content and the new content
		const patch = structuredPatch(cleanedFilePath, cleanedFilePath, currentContent, newContent, "", "")

		// Create a suggestion file
		const suggestionFile = suggestions.addFile(uriToUse)

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

	private async processDiffFormat(response: string, context: GhostSuggestionContext): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// Parse the diff to extract the file path
		const filePathMatch = response.match(/\+\+\+ b\/(.+?)$/m)
		if (!filePathMatch) {
			return suggestions // No file path found
		}

		const filePath = filePathMatch[1]

		// Create a URI for the file
		const fileUri = filePath.startsWith("file://")
			? vscode.Uri.parse(filePath)
			: vscode.Uri.parse(`file://${filePath}`)

		// Try to find the matching document in the context
		const openFiles = context.openFiles || []
		const matchingDocument = openFiles.find(
			(doc) =>
				vscode.workspace.asRelativePath(doc.uri, false) === filePath ||
				doc.uri.toString() === fileUri.toString(),
		)

		let documentToUse: vscode.TextDocument | undefined
		let uriToUse: vscode.Uri = fileUri

		if (matchingDocument) {
			documentToUse = matchingDocument
			uriToUse = matchingDocument.uri
		} else {
			// If we couldn't find a matching document, try to open the document
			try {
				documentToUse = await vscode.workspace.openTextDocument(fileUri)
			} catch (error) {
				console.error(`Error opening document ${filePath}:`, error)
				return suggestions // Return empty suggestions if we can't open the document
			}
		}

		if (!documentToUse) {
			return suggestions // Return empty suggestions if we can't find or open the document
		}

		// Create a suggestion file
		const suggestionFile = suggestions.addFile(uriToUse)

		// Parse the diff hunks
		const hunkMatches = response.matchAll(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@([\s\S]+?)(?=@@ |$)/g)

		for (const hunkMatch of hunkMatches) {
			const [_, oldStart, oldLength, newStart, newLength, hunkContent] = hunkMatch

			let currentOldLineNumber = parseInt(oldStart)
			let currentNewLineNumber = parseInt(newStart)

			// Split the hunk content into lines
			const lines = hunkContent.split("\n").filter((line) => line.length > 0)

			// Process each line in the hunk
			for (const line of lines) {
				if (line.startsWith("+")) {
					// Addition
					suggestionFile.addOperation({
						type: "+",
						line: currentNewLineNumber - 1,
						content: line.substring(1),
					})
					currentNewLineNumber++
				} else if (line.startsWith("-")) {
					// Deletion
					suggestionFile.addOperation({
						type: "-",
						line: currentOldLineNumber - 1,
						content: line.substring(1),
					})
					currentOldLineNumber++
				} else {
					// Context line
					currentOldLineNumber++
					currentNewLineNumber++
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}
}
