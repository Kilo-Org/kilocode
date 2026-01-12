// kilocode_change - new file

/**
 * Citation Navigation Service
 * Handles clickable citation navigation and source file opening
 */

import * as vscode from "vscode"
import * as path from "path"
import type { Citation } from "./types"

export interface NavigationOptions {
	/** Whether to open in a new editor tab */
	openInNewTab?: boolean
	/** Whether to preview the file */
	preview?: boolean
	/** Whether to preserve focus */
	preserveFocus?: boolean
	/** View column to open in */
	viewColumn?: vscode.ViewColumn
}

export interface NavigationResult {
	success: boolean
	uri?: vscode.Uri
	position?: vscode.Position
	range?: vscode.Range
	error?: string
}

export class CitationNavigationService {
	/**
	 * Navigate to a citation source
	 */
	async navigateToCitation(citation: Citation, options: NavigationOptions = {}): Promise<NavigationResult> {
		try {
			// Validate citation
			if (!citation.sourcePath) {
				return {
					success: false,
					error: "Citation has no source path",
				}
			}

			// Handle different citation types
			switch (citation.sourceType) {
				case "file":
					return await this.navigateToFile(citation, options)
				case "url":
					return await this.navigateToUrl(citation.sourcePath)
				case "documentation":
					return await this.navigateToDocumentation(citation.sourcePath)
				default:
					return {
						success: false,
						error: `Unknown citation type: ${citation.sourceType}`,
					}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Navigate to a file citation
	 */
	private async navigateToFile(citation: Citation, options: NavigationOptions): Promise<NavigationResult> {
		try {
			// Resolve file path (handle relative paths)
			const filePath = this.resolveFilePath(citation.sourcePath)
			const uri = vscode.Uri.file(filePath)

			// Check if file exists
			const fileExists = await this.fileExists(filePath)
			if (!fileExists) {
				return {
					success: false,
					error: `File not found: ${filePath}`,
				}
			}

			// Open the document
			const document = await vscode.workspace.openTextDocument(uri)
			const editor = await vscode.window.showTextDocument(document, {
				preview: options.preview ?? true,
				preserveFocus: options.preserveFocus ?? false,
				viewColumn: options.viewColumn,
			})

			// Navigate to specific line if provided
			if (citation.startLine) {
				const position = new vscode.Position(citation.startLine - 1, 0)
				const endLine = citation.endLine ?? citation.startLine
				const range = new vscode.Range(position, new vscode.Position(endLine - 1, 0))

				editor.selection = new vscode.Selection(range.start, range.end)
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter)

				return {
					success: true,
					uri,
					position,
					range,
				}
			}

			return {
				success: true,
				uri,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Navigate to a URL citation
	 */
	private async navigateToUrl(url: string): Promise<NavigationResult> {
		try {
			await vscode.env.openExternal(vscode.Uri.parse(url))
			return {
				success: true,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Navigate to documentation
	 */
	private async navigateToDocumentation(docPath: string): Promise<NavigationResult> {
		try {
			// Try to open as URL first
			if (docPath.startsWith("http://") || docPath.startsWith("https://")) {
				return await this.navigateToUrl(docPath)
			}

			// Try to open as file
			const filePath = this.resolveFilePath(docPath)
			const fileExists = await this.fileExists(filePath)

			if (fileExists) {
				return await this.navigateToFile(
					{
						id: "",
						messageId: "",
						sourceType: "file",
						sourcePath: filePath,
						snippet: "",
						confidence: 1,
					},
					{},
				)
			}

			// Fall back to web search
			const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(docPath)}`
			return await this.navigateToUrl(searchUrl)
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Navigate to multiple citations
	 */
	async navigateToCitations(citations: Citation[], options: NavigationOptions = {}): Promise<NavigationResult[]> {
		const results: NavigationResult[] = []

		for (const citation of citations) {
			const result = await this.navigateToCitation(citation, options)
			results.push(result)
		}

		return results
	}

	/**
	 * Get citation preview (snippet with context)
	 */
	async getCitationPreview(citation: Citation, contextLines: number = 3): Promise<string | null> {
		try {
			if (citation.sourceType !== "file" || !citation.sourcePath) {
				return citation.snippet || null
			}

			const filePath = this.resolveFilePath(citation.sourcePath)
			const fileExists = await this.fileExists(filePath)

			if (!fileExists) {
				return citation.snippet || null
			}

			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
			const lines = document.getText().split("\n")

			const startLine = citation.startLine || 1
			const endLine = citation.endLine || startLine

			const contextStart = Math.max(0, startLine - contextLines - 1)
			const contextEnd = Math.min(lines.length, endLine + contextLines)

			return lines.slice(contextStart, contextEnd).join("\n")
		} catch (error) {
			return citation.snippet || null
		}
	}

	/**
	 * Validate citation exists
	 */
	async validateCitation(citation: Citation): Promise<boolean> {
		try {
			switch (citation.sourceType) {
				case "file": {
					if (!citation.sourcePath) {
						return false
					}
					const filePath = this.resolveFilePath(citation.sourcePath)
					return await this.fileExists(filePath)
				}

				case "url":
					return citation.sourcePath?.startsWith("http://") || citation.sourcePath?.startsWith("https://")

				case "documentation":
					return !!citation.sourcePath

				default:
					return false
			}
		} catch {
			return false
		}
	}

	/**
	 * Get citation info for display
	 */
	getCitationInfo(citation: Citation): {
		label: string
		description: string
		detail: string
	} {
		let label = ""
		let description = ""
		let detail = ""

		switch (citation.sourceType) {
			case "file":
				label = path.basename(citation.sourcePath)
				description = citation.sourcePath
				detail = citation.startLine && citation.endLine ? `Lines ${citation.startLine}-${citation.endLine}` : ""
				break

			case "url":
				label = "External Link"
				description = citation.sourcePath
				detail = "Opens in browser"
				break

			case "documentation":
				label = "Documentation"
				description = citation.sourcePath
				detail = "Documentation reference"
				break
		}

		return {
			label,
			description,
			detail,
		}
	}

	/**
	 * Create a CodeLens for a citation
	 */
	createCitationCodeLens(citation: Citation): vscode.CodeLens {
		const range = new vscode.Range(0, 0, 0, 0)
		const info = this.getCitationInfo(citation)

		return new vscode.CodeLens(range, {
			title: `📚 ${info.label}`,
			tooltip: `Go to ${info.description}`,
			command: "kilo-code.chat.navigateToCitation",
			arguments: [citation],
		})
	}

	/**
	 * Create a Decoration for a citation
	 */
	createCitationDecoration(citation: Citation): vscode.ThemableDecorationAttachmentRenderOptions {
		const info = this.getCitationInfo(citation)
		const confidence = Math.round(citation.confidence * 100)

		return {
			contentText: `[${info.label} ${confidence}%]`,
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Resolve file path (handle relative paths)
	 */
	private resolveFilePath(filePath: string): string {
		// If already absolute, return as is
		if (path.isAbsolute(filePath)) {
			return filePath
		}

		// Resolve relative to workspace root
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			return path.join(workspaceFolders[0].uri.fsPath, filePath)
		}

		// Fall back to current working directory
		return path.resolve(filePath)
	}

	/**
	 * Check if file exists
	 */
	private async fileExists(filePath: string): Promise<boolean> {
		try {
			const uri = vscode.Uri.file(filePath)
			await vscode.workspace.fs.stat(uri)
			return true
		} catch {
			return false
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: CitationNavigationService | null = null

export function getCitationNavigationService(): CitationNavigationService {
	if (!instance) {
		instance = new CitationNavigationService()
	}
	return instance
}

export function resetCitationNavigationService(): void {
	instance = null
}
