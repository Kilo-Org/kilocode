import * as vscode from "vscode"
import { parsePatch } from "diff"

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

	parseResponse(response: string): vscode.WorkspaceEdit | null {
		const workspaceEdit = new vscode.WorkspaceEdit()
		const cleanedResponse = response.replace(/```diff\s*|\s*```/g, "").trim()
		if (!cleanedResponse) {
			return null // No valid diff found
		}
		const filePatches = parsePatch(cleanedResponse)

		for (const filePatch of filePatches) {
			if (!filePatch.newFileName || filePatch.newFileName === "/dev/null") {
				continue
			}

			// Handle file path properly
			const fileNameUri = filePatch.newFileName.replace(/^b\//, "")

			// Check if the path is already a URI or needs to be converted
			let fileUri: vscode.Uri
			if (fileNameUri.startsWith("file://")) {
				fileUri = vscode.Uri.parse(fileNameUri)
			} else if (fileNameUri.startsWith("/")) {
				// Absolute path
				fileUri = vscode.Uri.file(fileNameUri)
			} else {
				// Relative path - assume relative to workspace
				fileUri = vscode.Uri.file(fileNameUri)
			}

			// Validate hunks
			if (!filePatch.hunks || filePatch.hunks.length === 0) {
				continue
			}

			for (const hunk of filePatch.hunks) {
				// Validate hunk
				if (
					typeof hunk.oldStart !== "number" ||
					typeof hunk.newStart !== "number" ||
					typeof hunk.oldLines !== "number" ||
					typeof hunk.newLines !== "number"
				) {
					continue
				}

				// Line numbers in diff are 1-based, VS Code API is 0-based.
				let originalLineNumber = hunk.oldStart - 1
				let modifiedLineNumber = hunk.newStart - 1

				// First pass: collect all operations
				const operations = []

				// Make a copy of line numbers for tracking
				let currentOriginalLine = originalLineNumber
				let currentModifiedLine = modifiedLineNumber

				for (const line of hunk.lines) {
					if (!line || line.length === 0) {
						continue
					}

					const lineType = line[0]
					const lineContent = line.substring(1)

					if (lineType !== "+" && lineType !== "-" && lineType !== " ") {
						continue
					}

					const op = {
						type: lineType,
						content: lineContent,
						originalLine: lineType === "+" ? -1 : currentOriginalLine,
						modifiedLine: lineType === "-" ? -1 : currentModifiedLine,
					}

					operations.push(op)

					// Update line counters
					if (lineType === "-" || lineType === " ") {
						currentOriginalLine++
					}
					if (lineType === "+" || lineType === " ") {
						currentModifiedLine++
					}
				}

				for (const op of operations) {
					if (op.type === "-") {
						const start = new vscode.Position(op.originalLine, 0)
						const end = new vscode.Position(op.originalLine + 1, 0)
						const range = new vscode.Range(start, end)
						workspaceEdit.delete(fileUri, range)
					}
				}

				// Group consecutive additions and apply them as a single edit
				let groupStart = -1
				let groupContent = ""

				// Find consecutive additions and group them
				for (let i = 0; i < operations.length; i++) {
					const op = operations[i]
					if (op.type === "+") {
						// Start a new group if we don't have one
						if (groupStart === -1) {
							groupStart = op.modifiedLine
						}

						// Add content to the group
						const content = op.content.endsWith("\n") ? op.content : op.content + "\n"
						groupContent += content

						// If this is the last operation or the next one isn't consecutive, apply the group
						if (
							i === operations.length - 1 ||
							operations[i + 1].type !== "+" ||
							operations[i + 1].modifiedLine !== op.modifiedLine + 1
						) {
							// Apply the group
							if (groupStart !== -1) {
								const position = new vscode.Position(groupStart, 0)
								workspaceEdit.insert(fileUri, position, groupContent)

								// Reset the group
								groupStart = -1
								groupContent = ""
							}
						}
					}
				}
			}
		}
		return workspaceEdit
	}
}
