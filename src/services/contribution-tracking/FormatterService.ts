// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import * as crypto from "crypto"
import * as fs from "fs/promises"

/**
 * Service for headless formatting of code content using VSCode's formatting providers.
 *
 * This service creates temporary files on disk adjacent to the target file, formats them
 * using VSCode's formatting providers, and then cleans them up. This approach ensures:
 *
 * Key benefits:
 * - 100% config parity: Uses the exact formatter settings the user has configured
 * - Formatter compatibility: Works with formatters like Prettier that require real files
 * - Config file discovery: Formatters can find .prettierrc, .eslintrc, etc. relative to the file
 * - Invisible: Files are created, formatted, and deleted without user visibility
 */
export class FormatterService {
	private static instance: FormatterService

	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): FormatterService {
		if (!FormatterService.instance) {
			FormatterService.instance = new FormatterService()
		}
		return FormatterService.instance
	}

	/**
	 * Generate a unique temporary filename adjacent to the target file.
	 * Uses the same extension to ensure formatters recognize the file type.
	 *
	 * @param filePath - The original file path
	 * @returns The temporary file path
	 */
	private generateTempFilePath(filePath: string): string {
		const dir = path.dirname(filePath)
		const ext = path.extname(filePath)
		const uniqueId = crypto.randomBytes(8).toString("hex")
		const tempFileName = `.kilo-format-temp-${uniqueId}${ext}`
		return path.join(dir, tempFileName)
	}

	/**
	 * Apply text edits to a string content.
	 * This applies edits in reverse order to avoid offset issues.
	 *
	 * @param content - The original content
	 * @param edits - The text edits to apply
	 * @returns The content with edits applied
	 */
	private applyEditsToString(content: string, edits: vscode.TextEdit[]): string {
		// Split content into lines for easier manipulation
		const lines = content.split("\n")

		// Sort edits in reverse order (bottom to top, right to left)
		// This ensures earlier edits don't affect the positions of later edits
		const sortedEdits = [...edits].sort((a, b) => {
			if (a.range.start.line !== b.range.start.line) {
				return b.range.start.line - a.range.start.line
			}
			return b.range.start.character - a.range.start.character
		})

		// Apply each edit
		for (const edit of sortedEdits) {
			const startLine = edit.range.start.line
			const startChar = edit.range.start.character
			const endLine = edit.range.end.line
			const endChar = edit.range.end.character

			// Get the text before and after the edit range
			const beforeText =
				lines.slice(0, startLine).join("\n") +
				(startLine > 0 ? "\n" : "") +
				(lines[startLine]?.substring(0, startChar) || "")

			const afterText =
				(lines[endLine]?.substring(endChar) || "") +
				(endLine < lines.length - 1 ? "\n" + lines.slice(endLine + 1).join("\n") : "")

			// Combine with the new text
			const newContent = beforeText + edit.newText + afterText

			// Update lines array for next iteration
			lines.length = 0
			lines.push(...newContent.split("\n"))
		}

		return lines.join("\n")
	}

	/**
	 * Format raw content using VSCode's formatting providers via a temporary file.
	 *
	 * Creates a temporary file on disk adjacent to the target file, opens it invisibly,
	 * triggers the user's active formatter, reads the result, and cleans up.
	 * If no formatter is available or formatting fails, returns the original content.
	 *
	 * @param rawContent - The raw AI-generated content to format
	 * @param filePath - The absolute path to the target file (used for temp file location and extension)
	 * @returns The formatted content, or the original content if formatting fails
	 */
	async formatContent(rawContent: string, filePath: string): Promise<string> {
		let tempFilePath: string | null = null

		try {
			// 1. Generate a unique temp file path adjacent to the target file
			tempFilePath = this.generateTempFilePath(filePath)

			// 2. Write the raw content to the temp file
			await fs.writeFile(tempFilePath, rawContent, "utf8")

			// 3. Open the document without showing it to the user
			// Using vscode.Uri.file() with a real file path
			const tempUri = vscode.Uri.file(tempFilePath)
			const doc = await vscode.workspace.openTextDocument(tempUri)

			// 4. Get formatting options from the editor configuration
			const editorConfig = vscode.workspace.getConfiguration("editor", doc.uri)
			const formattingOptions: vscode.FormattingOptions = {
				tabSize: editorConfig.get<number>("tabSize", 4),
				insertSpaces: editorConfig.get<boolean>("insertSpaces", true),
			}

			// 5. Execute the format document provider (doesn't show UI)
			// This respects the user's formatter config (.prettierrc, etc.)
			// because the file is in the same directory as the target file
			const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
				"vscode.executeFormatDocumentProvider",
				doc.uri,
				formattingOptions,
			)

			// 6. If no formatter is installed or active, return raw (fallback)
			if (!edits || edits.length === 0) {
				return rawContent
			}

			// 7. Apply the edits to the string content directly
			// This avoids using vscode.workspace.applyEdit which might show the document
			const formattedText = this.applyEditsToString(rawContent, edits)

			return formattedText
		} catch (error) {
			// If formatting fails for any reason (syntax error, no formatter, etc.),
			// fall back to the raw content. This ensures we're never worse off
			// than the current behavior.
			console.debug("[FormatterService] Formatting failed, using raw content:", error)
			return rawContent
		} finally {
			// 8. Always clean up the temp file
			if (tempFilePath) {
				try {
					await fs.unlink(tempFilePath)
				} catch {
					// Ignore cleanup errors - file may not exist if creation failed
					console.debug("[FormatterService] Failed to clean up temp file:", tempFilePath)
				}
			}
		}
	}

	/**
	 * Format content based on file path.
	 * Convenience method that resolves the file path and formats the content.
	 *
	 * @param rawContent - The raw AI-generated content to format
	 * @param filePath - The file path (relative or absolute) to determine location and language
	 * @returns The formatted content, or the original content if formatting fails
	 */
	async formatContentForFile(rawContent: string, filePath: string): Promise<string> {
		// Resolve to absolute path if relative
		const absolutePath = path.isAbsolute(filePath)
			? filePath
			: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "", filePath)

		return this.formatContent(rawContent, absolutePath)
	}
}

/**
 * Format raw content using VSCode's formatting providers.
 *
 * This is a convenience function that handles getting the service instance.
 * Use this for simple one-off formatting operations.
 *
 * @param rawContent - The raw AI-generated content to format
 * @param filePath - The file path to determine the language
 * @returns The formatted content, or the original content if formatting fails
 */
export async function formatContentForFile(rawContent: string, filePath: string): Promise<string> {
	const service = FormatterService.getInstance()
	return service.formatContentForFile(rawContent, filePath)
}
