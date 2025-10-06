import * as vscode from "vscode"
import { EditableRegion, EditableRegionResult } from "./EditableRegionCalculator"

/**
 * Builds Mercury prompts with proper code-to-edit markers.
 * This shows exactly what gets sent to Mercury for editing.
 */
export class MercuryPromptBuilder {
	private static readonly MERCURY_MARKERS = {
		OPEN: "<|code_to_edit|>",
		CLOSE: "<|/code_to_edit|>",
		CURSOR: "<|cursor|>",
	}

	/**
	 * Build the current file content block with editable region markers.
	 * This is the core of what Mercury sees - full file with marked editable region.
	 */
	public buildCurrentFileContentBlock(
		document: vscode.TextDocument,
		cursorRange: vscode.Range,
		editableRegion: EditableRegion,
	): string {
		const lines = document.getText().split("\n")
		const cursorLine = cursorRange.start.line
		const cursorCharacter = cursorRange.start.character

		const { OPEN, CLOSE, CURSOR } = MercuryPromptBuilder.MERCURY_MARKERS
		const { editableStart, editableEnd } = editableRegion

		// Build numbered lines with markers
		// Use #| format (matching Continue's approach) for line numbers
		const numberedLines = lines.map((line, index) => {
			let numberedLine = `${index + 1} #| ${line}`

			// Add cursor marker if this is the cursor line
			if (index === cursorLine) {
				const beforeCursor = line.substring(0, cursorCharacter)
				const afterCursor = line.substring(cursorCharacter)
				const lineWithCursor = `${beforeCursor}${CURSOR}${afterCursor}`
				numberedLine = `${index + 1} #| ${lineWithCursor}`
			}

			// Add editable region markers
			if (index === editableStart) {
				numberedLine = `${OPEN}\n${numberedLine}`
			}
			if (index === editableEnd) {
				numberedLine = `${numberedLine}\n${CLOSE}`
			}

			return numberedLine
		})

		return numberedLines.join("\n")
	}

	/**
	 * Build recently viewed code snippets block
	 */
	public buildRecentlyViewedCodeSnippetsBlock(
		recentlyViewedSnippets: Array<{ content: string; filepath: string }>,
	): string {
		if (recentlyViewedSnippets.length === 0) {
			return ""
		}

		const snippetBlocks = recentlyViewedSnippets.map((snippet) => {
			return `File: ${snippet.filepath}\n\`\`\`\n${snippet.content}\n\`\`\``
		})

		return snippetBlocks.join("\n\n")
	}

	/**
	 * Build edit history block
	 */
	public buildEditHistoryBlock(editHistory: string[]): string {
		return editHistory.length > 0 ? editHistory.join("\n\n") : "No recent edit history available."
	}

	/**
	 * Build complete Mercury user prompt
	 */
	public buildUserPrompt(
		document: vscode.TextDocument,
		cursorRange: vscode.Range,
		editableRegion: EditableRegion,
		recentlyViewedSnippets: Array<{ content: string; filepath: string }> = [],
		editHistory: string[] = [],
	): string {
		const recentlyViewedBlock = this.buildRecentlyViewedCodeSnippetsBlock(recentlyViewedSnippets)
		const currentFileBlock = this.buildCurrentFileContentBlock(document, cursorRange, editableRegion)
		const editHistoryBlock = this.buildEditHistoryBlock(editHistory)

		return `<|recently_viewed_code_snippets|>
${recentlyViewedBlock}
<|/recently_viewed_code_snippets|>

<|current_file_content|>
${currentFileBlock}
<|/current_file_content|>

<|edit_diff_history|>
${editHistoryBlock}
<|/edit_diff_history|>`
	}

	/**
	 * Extract just the editable region content that will be compared with Mercury's response
	 */
	public extractEditableRegionForComparison(document: vscode.TextDocument, editableRegion: EditableRegion): string {
		const lines = document.getText().split("\n")
		return lines.slice(editableRegion.editableStart, editableRegion.editableEnd + 1).join("\n")
	}

	/**
	 * Get debug info about prompt construction
	 */
	public getPromptDebugInfo(
		document: vscode.TextDocument,
		editableRegion: EditableRegion,
		recentlyViewedSnippets: Array<{ content: string; filepath: string }> = [],
		editHistory: string[] = [],
	): {
		totalLines: number
		editableLines: number
		editableRange: string
		recentSnippetsCount: number
		editHistoryCount: number
		estimatedTokens: number
	} {
		const totalLines = document.lineCount
		const editableLines = editableRegion.editableEnd - editableRegion.editableStart + 1
		const editableRange = `${editableRegion.editableStart + 1}-${editableRegion.editableEnd + 1}`

		// Rough token estimate (4 chars = 1 token)
		const promptContent = this.buildUserPrompt(
			document,
			new vscode.Range(0, 0, 0, 0),
			editableRegion,
			recentlyViewedSnippets,
			editHistory,
		)
		const estimatedTokens = Math.ceil(promptContent.length / 4)

		return {
			totalLines,
			editableLines,
			editableRange,
			recentSnippetsCount: recentlyViewedSnippets.length,
			editHistoryCount: editHistory.length,
			estimatedTokens,
		}
	}
}
