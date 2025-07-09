import * as vscode from "vscode"
import { parsePatch } from "diff"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationType } from "./types"

export class GhostStrategy {
	getSystemPrompt() {
		return `You are an advanced AI-powered code assistant integrated directly into a VS Code extension. Your primary function is to act as a proactive pair programmer. You will analyze the user's context—including recent changes and their current cursor focus—to predict and suggest the next logical code modifications.

**Core Instructions:**

1.  **Analyze Full Context:** Scrutinize all provided information:
    * **Recent Changes (Diff):** Understand the user's recent modifications to infer their broader goal.
    * **User Focus (Cursor/Selection):** Pay close attention to the user's current cursor position or selection, as it indicates their immediate area of focus. Suggestions should be highly relevant to this specific location.
2.  **Predict Subsequent Changes:** Based on the full context, anticipate the follow-up code that would logically be written or modified.
3.  **Strict Diff Patch Format:** Your entire response **MUST** be a single, valid diff patch. This format is essential for programmatic application. Do not include any conversational text or explanations outside of the diff itself.
4.  **Keep the file name in the diff patch:** The diff patch must include the absolute path in the file name as is provided. This is crucial for the VS Code API to apply the changes correctly.
5.  **Propagate Changes:** Ensure consistency across the codebase. If your suggestion involves renaming or altering a signature, generate a patch that updates its definition and all relevant usages in the provided files.
6.  **Maintain Code Quality:** Your suggested changes must be syntactically correct, stylistically consistent with the existing code, and follow good programming practices.

---`
	}

	getSuggestionPrompt(document: vscode.TextDocument, range: vscode.Range | vscode.Selection) {
		const languageId = document.languageId
		const selectedText = document.getText(range)
		const cursorLine = range.start.line + 1 // 1-based line number
		const cursorCharacter = range.start.character + 1 // 1-based character position
		const documentUri = document.uri.toString()
		return `[INST]
I am writing code and need a suggestion for what to write next. Please analyze my current context and generate a diff patch for the code that should be added or changed.

**Recent Changes (Diff):**
[No recent diff applicable]

**User Focus:**
Cursor Position: Line ${cursorLine}, Character ${cursorCharacter}

**Selected Text:**
\`\`\`${languageId}
${selectedText}\`\`\`

**Current Document: ${documentUri}**
\`\`\`${languageId}
${document.getText()}\`\`\`
[/INST]
    `
	}

	parseResponse(response: string): GhostSuggestionEditOperation[] {
		const operations: GhostSuggestionEditOperation[] = []
		const cleanedResponse = response.replace(/```diff\s*|\s*```/g, "").trim()
		if (!cleanedResponse) {
			return [] // No valid diff found
		}
		const filePatches = parsePatch(cleanedResponse)
		for (const filePatch of filePatches) {
			// Determine the file path from the patch header.
			// It prefers the new file name, falling back to the old one.
			// The regex removes the 'a/' or 'b/' prefixes common in git diffs.
			const filePath = (filePatch.newFileName || filePatch.oldFileName || "").replace(/^[ab]\//, "")

			// If a file path can't be determined (e.g., for /dev/null), skip this patch.
			if (!filePath || filePath === "/dev/null") {
				continue
			}

			const fileUri = vscode.Uri.file(filePath)

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
							operations.push({
								type: "+",
								fileUri: fileUri,
								line: currentNewLineNumber - 1,
								content: content,
							})
							// Only increment the new line counter for additions and context lines.
							currentNewLineNumber++
							break

						// Case 2: The line is a deletion.
						case "-":
							operations.push({
								type: "-",
								fileUri: fileUri,
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

		return operations
	}
}
