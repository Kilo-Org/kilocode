import * as vscode from "vscode"
import { countTokens } from "../../utils/tokenHelpers"

/**
 * Result of calculating an editable region
 */
export interface EditableRegionResult {
	content: string // The actual text content
	startLine: number // Starting line in document (0-based)
	endLine: number // Ending line in document (0-based)
	tokensUsed: number // Actual tokens used
}

/**
 * Legacy interface for backward compatibility with tests
 * @deprecated Use EditableRegionResult instead
 */
export interface EditableRegion {
	editableStart: number
	editableEnd: number
	totalLines: number
	tokensUsed: number
}

/**
 * Simplified editable region calculator that returns content and positions in one call.
 * Uses proper tiktoken-based token counting.
 */
export class EditableRegionCalculator {
	/**
	 * Calculate editable region and return content + positions in one call.
	 * This is what Mercury strategy actually needs - no separate extract step.
	 */
	public calculateEditableRegionContent(
		document: vscode.TextDocument,
		cursorRange: vscode.Range,
		maxTokens: number = 512,
	): EditableRegionResult {
		const fileLines = document.getText().split("\n")
		const cursorLine = cursorRange.start.line

		console.log("EditableRegionCalculator DEBUG:")
		console.log("  fileLines.length:", fileLines.length)
		console.log("  cursorLine:", cursorLine)
		console.log(
			"  fileLines:",
			fileLines.map((line, i) => `${i}: "${line}"`),
		)

		// Start with just the cursor line
		let startLine = cursorLine
		let endLine = cursorLine
		let currentContent = fileLines[cursorLine] || ""
		let totalTokens = countTokens(currentContent)

		console.log("  initial currentContent:", JSON.stringify(currentContent))

		// Expand alternately above and below cursor
		let expandAbove = true
		while (totalTokens < maxTokens) {
			let addedLine = false

			if (expandAbove) {
				if (startLine > 0) {
					const candidateLine = fileLines[startLine - 1]
					const candidateTokens = countTokens(candidateLine)

					if (totalTokens + candidateTokens <= maxTokens) {
						startLine--
						currentContent = candidateLine + "\n" + currentContent
						totalTokens += candidateTokens
						addedLine = true
						console.log(`  expanded above to line ${startLine}: "${candidateLine}"`)
					}
				}
			} else {
				if (endLine < fileLines.length - 1) {
					const candidateLine = fileLines[endLine + 1]
					const candidateTokens = countTokens(candidateLine)

					if (totalTokens + candidateTokens <= maxTokens) {
						endLine++
						currentContent = currentContent + "\n" + candidateLine
						totalTokens += candidateTokens
						addedLine = true
						console.log(`  expanded below to line ${endLine}: "${candidateLine}"`)
					}
				}
			}

			if (!addedLine) break
			// CRITICAL FIX: Always try to include the final closing brace if we're missing it
			// This ensures we capture complete code blocks
			if (endLine < fileLines.length - 1) {
				const nextLine = fileLines[endLine + 1]
				if (nextLine.trim() === "}" || nextLine.trim() === "};") {
					const extraTokens = countTokens(nextLine)
					// Include closing brace even if it slightly exceeds token limit
					if (totalTokens + extraTokens <= maxTokens + 10) {
						// Small buffer for closing braces
						endLine++
						currentContent = currentContent + "\n" + nextLine
						totalTokens += extraTokens
						console.log(`  included closing brace at line ${endLine}: "${nextLine}"`)
					}
				}
			}
			expandAbove = !expandAbove
		}

		console.log("  final startLine:", startLine, "endLine:", endLine)
		console.log("  final currentContent:", JSON.stringify(currentContent))

		return {
			content: currentContent,
			startLine,
			endLine,
			tokensUsed: totalTokens,
		}
	}

	/**
	 * Legacy method for backward compatibility with tests
	 * @deprecated Use calculateEditableRegionContent instead
	 */
	public calculateEditableRegion(
		document: vscode.TextDocument,
		cursorRange: vscode.Range,
		maxTokens: number = 512,
	): EditableRegion {
		const result = this.calculateEditableRegionContent(document, cursorRange, maxTokens)
		return {
			editableStart: result.startLine,
			editableEnd: result.endLine,
			totalLines: document.lineCount,
			tokensUsed: result.tokensUsed,
		}
	}

	/**
	 * Legacy method for backward compatibility with tests
	 * @deprecated Use calculateEditableRegionContent instead
	 */
	public extractEditableContent(document: vscode.TextDocument, region: EditableRegion): string {
		const lines = document.getText().split("\n")
		return lines.slice(region.editableStart, region.editableEnd + 1).join("\n")
	}
}
