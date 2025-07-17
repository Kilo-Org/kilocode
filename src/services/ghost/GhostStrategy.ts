import * as vscode from "vscode"
import { parsePatch, ParsedDiff, applyPatch, structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"
import Fuse from "fuse.js"

export class GhostStrategy {
	getSystemPrompt(customInstructions: string = "") {
		const basePrompt = `You are an advanced AI-powered code assistant integrated directly into a VS Code extension. Your primary function is to act as a proactive pair programmer. You will analyze the user's context—including recent changes and their current cursor focus—to predict and suggest the next logical code modifications.

## Core Instructions

1.  **Analyze Full Context:** Scrutinize all provided information:
    * **Recent Changes (Diff):** Understand the user's recent modifications to infer their broader goal.
    * **User Focus (Cursor/Selection):** Pay close attention to the user's current cursor position or selection, as it indicates their immediate area of focus. Suggestions should be highly relevant to this specific location.
2.  **Predict Subsequent Changes:** Based on the full context, anticipate the follow-up code that would logically be written or modified.
3.  **Strict Diff Patch Format:** Your entire response **MUST** be a single, valid diff patch. This format is essential for programmatic application. Do not include any conversational text or explanations outside of the diff itself.
4.  **CRITICAL: Hunk Header Accuracy** Your primary output is a diff patch that will be programmatically applied. The \`@@ -a,b +c,d @@\` hunk headers MUST be perfectly accurate. Before outputting the diff, internally verify the starting line number and the line counts for both the original and modified sections. An incorrect hunk header will cause the entire operation to fail. Double-check your calculations.
5.  **Keep the file name in the diff patch:** The diff patch must include the absolute path in the file name as is provided. This is crucial for the VS Code API to apply the changes correctly.
6.  **Propagate Changes:** Ensure consistency across the codebase. If your suggestion involves renaming or altering a signature, generate a patch that updates its definition and all relevant usages in the provided files.
7.  **Maintain Code Quality:** Your suggested changes must be syntactically correct, stylistically consistent with the existing code, and follow good programming practices.

## CRITICAL: Diff Patch Output Rules
- DO NOT include any memory bank status indicators like "[Memory Bank: Active]" or "[Memory Bank: Missing]"
- DO NOT include any conversational text, explanations, or commentary
- ONLY generate a clean, valid diff patch as specified below
---`

		return customInstructions ? `${basePrompt}${customInstructions}` : basePrompt
	}

	private getBaseSuggestionPrompt() {
		return `I am writing code and need a suggestion for what to write next. Please analyze my current context and generate a diff patch for the code that should be added or changed.`
	}

	private getRecentChangesDiff() {
		return ""
		// return `**Recent Changes (Diff):**
		// [No recent diff applicable]
		// `
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

	getSuggestionPrompt(context: GhostSuggestionContext) {
		const sections = [
			this.getBaseSuggestionPrompt(),
			this.getUserInputPrompt(context),
			this.getRecentChangesDiff(),
			this.getUserFocusPrompt(context),
			this.getUserSelectedTextPrompt(context),
			this.getUserCurrentDocumentPrompt(context),
		]

		return `[INST]
${sections.filter(Boolean).join("\n\n")}
[/INST]
`
	}

	private async FuzzyMatchDiff(diff: string, context: GhostSuggestionContext) {
		const openFiles = context.openFiles || []
		const openFilesUris = openFiles.map((doc) => ({
			relativePath: vscode.workspace.asRelativePath(doc.uri, false),
			uri: doc.uri,
		}))
		const openFilesRepository = new Fuse(openFilesUris, {
			includeScore: true,
			threshold: 0.6,
			keys: ["relativePath"],
		})

		const filePatches = parsePatch(diff)
		for (const filePatch of filePatches) {
			// If the file patch has no hunks, skip it.
			if (!filePatch.hunks || filePatch.hunks.length === 0) {
				continue
			}

			const filePath = (filePatch.newFileName || filePatch.oldFileName || "").replace(/^[ab]\//, "")
			if (!filePath || filePath === "/dev/null") {
				continue
			}

			const matchedFiles = openFilesRepository.search(filePath)
			if (matchedFiles.length === 0) {
				continue // Skip if no files match the fuzzy search
			}
			const bestUriMatch = matchedFiles[0].item.uri
			const document = await vscode.workspace.openTextDocument(bestUriMatch)
			if (!document) {
				continue // Skip if the document cannot be opened
			}
			const documentContent = document.getText()

			const newContent = applyPatch(documentContent, diff, {
				fuzzFactor: 0.2,
			})

			console.log("New content after applying patch:", newContent)

			if (!newContent) {
				continue // Skip if the patch could not be applied
			}

			// Update the file names in the patch to use the matched URI string
			const matchedUriString = bestUriMatch.toString()
			filePatch.oldFileName = matchedUriString
			filePatch.newFileName = matchedUriString
			filePatch.hunks = structuredPatch(filePath, filePath, documentContent, newContent, "", "").hunks
		}
		return filePatches as ParsedDiff[]
	}

	async parseResponse(response: string, context: GhostSuggestionContext): Promise<GhostSuggestionsState> {
		const suggestions = new GhostSuggestionsState()
		const cleanedResponse = response.replace(/```diff\s*|\s*```/g, "").trim()
		if (!cleanedResponse) {
			return suggestions // No valid diff found
		}
		const filePatches = await this.FuzzyMatchDiff(cleanedResponse, context)
		for (const filePatch of filePatches) {
			// Determine the file path from the patch header.
			// It prefers the new file name, falling back to the old one.
			// The regex removes the 'a/' or 'b/' prefixes common in git diffs.
			const filePath = (filePatch.newFileName || filePatch.oldFileName || "").replace(/^[ab]\//, "")

			// If a file path can't be determined (e.g., for /dev/null), skip this patch.
			if (!filePath || filePath === "/dev/null") {
				continue
			}

			const fileUri = filePath.startsWith("file://")
				? vscode.Uri.parse(filePath)
				: vscode.Uri.parse(`file://${filePath}`)

			const suggestionFile = suggestions.addFile(fileUri)

			// Each file patch contains one or more "hunks," which are contiguous
			// blocks of changes.
			for (const hunk of filePatch.hunks) {
				let currentOldLineNumber = hunk.oldStart
				let currentNewLineNumber = hunk.newStart

				// Iterate over each line within the hunk.
				for (const line of hunk.lines) {
					const operationType = line.charAt(0) as GhostSuggestionEditOperationType
					const content = line.substring(1)

					switch (operationType) {
						// Case 1: The line is an addition.
						case "+":
							suggestionFile.addOperation({
								type: "+",
								line: currentNewLineNumber - 1,
								content: content,
							})
							// Only increment the new line counter for additions and context lines.
							currentNewLineNumber++
							break

						// Case 2: The line is a deletion.
						case "-":
							suggestionFile.addOperation({
								type: "-",
								line: currentOldLineNumber - 1,
								content: content,
							})
							// Only increment the old line counter for deletions and context lines.
							currentOldLineNumber++
							break

						// Case 3: The line is unchanged (context).
						default:
							// For context lines, we increment both counters as they exist
							// in both the old and new versions of the file.
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
}
