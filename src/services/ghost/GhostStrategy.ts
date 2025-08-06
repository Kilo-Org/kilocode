/* eslint-disable no-control-regex */
import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"

export class GhostStrategy {
	getSystemPrompt(customInstructions: string = "") {
		const basePrompt = `\
You are an expert-level AI pair programmer.
Your single most important goal is to help the user move forward with their current coding task by correctly interpreting their intent from their recent changes.
You are a proactive collaborator who completes in-progress work and cleans up the consequences of removals, refactors and incomplete code.
When you see incomplete code, be creative and helpful - infer the user's intent from context clues like variable names, existing patterns, and the surrounding code. Always complete what they started rather than suggesting deletion.

## Core Directives

1. **First, Analyze the Change Type:** Your first step is to analyze the \`Recent Changes (Diff)\`. Is the user primarily **adding/modifying** code or **deleting** code? This determines your entire strategy.

2. **Recognize User Intent:** The user's changes are intentional. If they rename a variable, they want that rename propagated. If they delete code, they want related code cleaned up. **Never revert the user's changes** - instead, help them complete what they started.

3.  **Analyze Full Context:** Scrutinize all provided information:
    
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

4.  **Strict JSON Array Output Format:** Your entire response **MUST** be a valid JSON array containing objects with the following structure:
    * Each object must have exactly two properties: "path" and "content"
    * "path": The full file URI (e.g., "file:///absolute/path/to/file.tsx")
    * "content": The complete, updated content of that file with proper JSON ESCAPING (quotes as \", newlines as \n, etc.)
    * **Example:**
      \`\`\`json
      [
        {
          "path": "file:///Users/catrielmuller/Dev/KiloOrg/example/projects/react/src/App.tsx",
          "content": "import React from 'react';\\n\\nfunction App() {\\n  return <div>Hello World</div>;\\n}\\n\\nexport default App;"
        }
      ]
      \`\`\`
    * Do not include any conversational text, explanations, or any text outside of this required JSON format.
    * Ensure all special characters in the content are properly escaped according to JSON standards.
    * **Important**: Preserve the exact formatting of the input document, including any empty last lines. If the input document ends with an empty line, your output content must also end with an empty line (represented as \\n at the end).
`

		return customInstructions ? `${basePrompt}${customInstructions}` : basePrompt
	}

	private getBaseSuggestionPrompt() {
		return `\
# Task
Analyze my recent code modifications to infer my underlying intent. Based on that intent, identify all related code that is now obsolete or inconsistent and generate the complete, updated file content to complete the task.

# Instructions
1.  **Infer Intent:** First, analyze the \`Recent Changes (Diff)\` to form a hypothesis about my goal. If I've started writing something incomplete, infer what I'm trying to achieve.
2.  **Be Creative and Helpful:** For incomplete code (like \`const onButtonHoldClick = \`), use context clues to complete it intelligently. Consider the name, surrounding code, and common patterns.
3.  **Identify All Impacts:** Based on the inferred intent, scan the \`Current Document\` to find every piece of code that is affected. This includes component usages, variables, and related text or comments that are now obsolete.
4.  **Fix Document Diagnostics:** If the \`Current Document\` has diagnostics, assume they are now obsolete due to the changes. Remove or update them as necessary.
5.  **Generate JSON Array Response:** Your response must be a valid JSON array containing objects with "path" and "content" properties. The "path" must be the full file URI, and "content" must contain the entire, updated content of the file. **Important**: Preserve the exact formatting of the input document, including any empty last lines.

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

	private safeJsonParse(jsonContent: string): any {
		try {
			// First, try direct parsing
			return JSON.parse(jsonContent)
		} catch (error) {
			// If direct parsing fails, try to fix common issues with escaped content
			try {
				// More robust approach: manually parse and fix the JSON structure
				let fixedContent = jsonContent

				// First, try to find and fix the content field using a more comprehensive approach
				// This handles cases where the content spans multiple lines and contains unescaped quotes
				const arrayMatch = fixedContent.match(/^\s*\[\s*([\s\S]*)\s*\]\s*$/)
				if (arrayMatch) {
					const arrayContent = arrayMatch[1]

					// Split by objects (looking for },{ pattern but being careful about content)
					const objects = []
					let currentObject = ""
					let braceCount = 0
					let inString = false
					let escapeNext = false

					for (let i = 0; i < arrayContent.length; i++) {
						const char = arrayContent[i]

						if (escapeNext) {
							escapeNext = false
							currentObject += char
							continue
						}

						if (char === "\\") {
							escapeNext = true
							currentObject += char
							continue
						}

						if (char === '"' && !escapeNext) {
							inString = !inString
						}

						if (!inString) {
							if (char === "{") {
								braceCount++
							} else if (char === "}") {
								braceCount--
								if (braceCount === 0) {
									currentObject += char
									objects.push(currentObject.trim())
									currentObject = ""
									// Skip comma and whitespace
									while (i + 1 < arrayContent.length && /[,\s]/.test(arrayContent[i + 1])) {
										i++
									}
									continue
								}
							}
						}

						currentObject += char
					}

					// Process any remaining object
					if (currentObject.trim()) {
						objects.push(currentObject.trim())
					}

					// Now fix each object
					const fixedObjects = objects.map((objStr) => {
						// Extract path and content fields
						const pathMatch = objStr.match(/"path":\s*"([^"]*)"/)
						const contentMatch = objStr.match(/"content":\s*"([\s\S]*?)"\s*(?=\s*\})/s)

						if (pathMatch && contentMatch) {
							const path = pathMatch[1]
							const content = contentMatch[1]

							// First, unescape any existing escapes to get the raw content
							const unescapedContent = content
								.replace(/\\"/g, '"') // Unescape quotes
								.replace(/\\\\/g, "\\") // Unescape backslashes
								.replace(/\\n/g, "\n") // Unescape newlines
								.replace(/\\r/g, "\r") // Unescape carriage returns
								.replace(/\\t/g, "\t") // Unescape tabs

							// Then properly escape for JSON parsing
							const escapedContent = unescapedContent
								.replace(/\\/g, "\\\\") // Escape backslashes first
								.replace(/"/g, '\\"') // Escape quotes
								.replace(/\n/g, "\\n") // Escape newlines
								.replace(/\r/g, "\\r") // Escape carriage returns
								.replace(/\t/g, "\\t") // Escape tabs
								.replace(/[\x00-\x1f\x7f-\x9f]/g, (char: string) => {
									// Escape all control characters
									return "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4)
								})

							return `{"path": "${path}", "content": "${escapedContent}"}`
						}

						return objStr
					})

					fixedContent = `[${fixedObjects.join(", ")}]`
				}

				return JSON.parse(fixedContent)
			} catch (secondError) {
				// If both attempts fail, throw the original error
				throw error
			}
		}
	}

	async parseResponse(response: string, context: GhostSuggestionContext): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		// First, try to parse as JSON array format (direct JSON)
		try {
			const jsonResponse = JSON.parse(response.trim())
			if (Array.isArray(jsonResponse)) {
				return await this.processJsonArrayFormat(jsonResponse, context)
			}
		} catch (error) {
			// Not valid JSON, continue with other formats
		}

		// Second, try to extract JSON from markdown code blocks
		const jsonCodeBlockMatch = response.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/m)
		if (jsonCodeBlockMatch) {
			try {
				const jsonContent = jsonCodeBlockMatch[1].trim()

				// Try to parse the JSON content with better error handling
				const jsonResponse = this.safeJsonParse(jsonContent)
				if (Array.isArray(jsonResponse)) {
					return await this.processJsonArrayFormat(jsonResponse, context)
				}
			} catch (error) {
				console.warn("Failed to parse JSON from code block:", error)
			}
		}

		// Fallback: check for a response with a filePath (legacy format)
		const fullContentMatch = response.match(/^(.+?)\r?\n```[\w-]*\r?\n([\s\S]+?)```/m)
		if (fullContentMatch) {
			const [_, filePath, newContent] = fullContentMatch
			return await this.processFullContentFormat(filePath, newContent, context)
		}

		// If the LLM response didn't include a filePath, fallback to assuming
		// the file to modify is the context.document
		const contentMatchNoFilePath = response.match(/^```[\w-]*\r?\n([\s\S]+?)```$/m)
		if (contentMatchNoFilePath) {
			const [_, newContent] = contentMatchNoFilePath
			const relativeFilePath = vscode.workspace.asRelativePath(context.document.uri, false)
			return await this.processFullContentFormat(relativeFilePath, newContent, context)
		}

		// Check if the response is in the old diff format
		if (response.includes("--- a/") && response.includes("+++ b/")) {
			return await this.processDiffFormat(response, context)
		}

		// No valid format found
		return suggestions
	}

	private async processJsonArrayFormat(
		jsonArray: Array<{ path: string; content: string }>,
		context: GhostSuggestionContext,
	): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()

		for (const fileObj of jsonArray) {
			if (!fileObj.path || typeof fileObj.content !== "string") {
				console.warn("Invalid JSON object format: missing path or content")
				continue
			}

			// Parse the file URI
			let fileUri: vscode.Uri
			try {
				fileUri = vscode.Uri.parse(fileObj.path)
			} catch (error) {
				console.error(`Error parsing file URI ${fileObj.path}:`, error)
				continue
			}

			// Try to find the matching document in the context
			const openFiles = context.openFiles || []
			const matchingDocument = openFiles.find(
				(doc) =>
					doc.uri.toString() === fileUri.toString() ||
					vscode.workspace.asRelativePath(doc.uri, false) === vscode.workspace.asRelativePath(fileUri, false),
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
					console.error(`Error opening document ${fileObj.path}:`, error)
					continue // Skip this file if we can't open it
				}
			}

			if (!documentToUse) {
				continue // Skip this file if we can't find or open the document
			}

			// Get the current content of the file
			const currentContent = documentToUse.getText()

			// The content from JSON is already properly unescaped by JSON.parse()
			// No additional processing needed for escaped characters
			const newContent = fileObj.content

			// Generate a diff between the current content and the new content
			const relativePath = vscode.workspace.asRelativePath(uriToUse, false)
			const patch = structuredPatch(relativePath, relativePath, currentContent, newContent, "", "")

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
		}

		suggestions.sortGroups()
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
