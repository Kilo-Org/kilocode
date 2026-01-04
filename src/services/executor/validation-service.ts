// kilocode_change - new file

import * as vscode from "vscode"
import { FileSystemService, Transaction } from "./file-system-service"
import { ParsedEdit, ParseResult, EditParser } from "./edit-parser"

export interface LSPDiagnostic {
	filePath: string
	range: vscode.Range
	severity: vscode.DiagnosticSeverity
	message: string
	code?: string
	source?: string
}

export interface ValidationResult {
	isValid: boolean
	diagnostics: LSPDiagnostic[]
	syntaxErrors: string[]
	warnings: string[]
}

export interface PendingEdit {
	id: string
	edit: ParsedEdit
	originalContent: string
	newContent: string
	diagnostics: LSPDiagnostic[]
	status: "pending" | "accepted" | "rejected"
	timestamp: number
}

/**
 * LSP & Syntax Validation Service
 */
export class ValidationService {
	private diagnostics: Map<string, LSPDiagnostic[]> = new Map()
	private pendingEdits: Map<string, PendingEdit[]> = new Map()

	constructor(private workspaceRoot: string) {}

	/**
	 * Validate edits using LSP and syntax checking
	 */
	async validateEdits(edits: ParsedEdit[]): Promise<ValidationResult> {
		const allDiagnostics: LSPDiagnostic[] = []
		const syntaxErrors: string[] = []
		const warnings: string[] = []

		for (const edit of edits) {
			try {
				// Get LSP diagnostics for the file
				const lspDiagnostics = await this.getLSPDiagnostics(edit.filePath)

				// Apply edit temporarily to check syntax
				const syntaxCheck = await this.checkSyntax(edit)

				// Combine results
				allDiagnostics.push(...lspDiagnostics)
				syntaxErrors.push(...syntaxCheck.errors)
				warnings.push(...syntaxCheck.warnings)
			} catch (error) {
				syntaxErrors.push(`Validation error for ${edit.filePath}: ${error}`)
			}
		}

		return {
			isValid:
				syntaxErrors.length === 0 &&
				allDiagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length === 0,
			diagnostics: allDiagnostics,
			syntaxErrors,
			warnings,
		}
	}

	/**
	 * Get LSP diagnostics for a file
	 */
	private async getLSPDiagnostics(filePath: string): Promise<LSPDiagnostic[]> {
		const uri = vscode.Uri.file(filePath)
		const diagnostics = vscode.languages.getDiagnostics(uri)

		return diagnostics.map((diagnostic) => ({
			filePath,
			range: diagnostic.range,
			severity: diagnostic.severity,
			message: diagnostic.message,
			code: diagnostic.code as string,
			source: diagnostic.source,
		}))
	}

	/**
	 * Check syntax for an edit
	 */
	private async checkSyntax(edit: ParsedEdit): Promise<{ errors: string[]; warnings: string[] }> {
		const errors: string[] = []
		const warnings: string[] = []

		try {
			// Read current file content
			const fs = require("fs").promises
			const path = require("path")
			const fullPath = path.resolve(this.workspaceRoot, edit.filePath)

			let currentContent = ""
			try {
				currentContent = await fs.readFile(fullPath, "utf8")
			} catch {
				// File doesn't exist, that's ok for new files
			}

			// Apply edit temporarily
			let newContent = currentContent
			switch (edit.type) {
				case "search_replace":
					newContent = this.applySearchReplace(currentContent, edit.search || "", edit.replace || "")
					break
				case "insert":
					newContent = this.applyInsert(
						currentContent,
						edit.replace || "",
						edit.position || "before",
						edit.anchor || "",
					)
					break
				case "delete":
					newContent = this.applyDelete(currentContent, edit.search || "")
					break
			}

			// Basic syntax validation based on file extension
			const extension = edit.filePath.split(".").pop()?.toLowerCase()
			const syntaxValidation = this.validateSyntaxByLanguage(newContent, extension || "")

			errors.push(...syntaxValidation.errors)
			warnings.push(...syntaxValidation.warnings)
		} catch (error) {
			errors.push(`Syntax check failed: ${error}`)
		}

		return { errors, warnings }
	}

	/**
	 * Validate syntax based on language
	 */
	private validateSyntaxByLanguage(content: string, extension: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		switch (extension) {
			case "py":
				return this.validatePythonSyntax(content)
			case "js":
			case "jsx":
				return this.validateJavaScriptSyntax(content)
			case "ts":
			case "tsx":
				return this.validateTypeScriptSyntax(content)
			case "xml":
				return this.validateXMLSyntax(content)
			case "json":
				return this.validateJSONSyntax(content)
			default:
				// Basic validation for other languages
				return this.validateGenericSyntax(content)
		}
	}

	/**
	 * Validate Python syntax
	 */
	private validatePythonSyntax(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// Basic Python syntax checks
		const lines = content.split("\n")
		let indentStack = [0]

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const trimmed = line.trim()

			// Skip empty lines and comments
			if (!trimmed || trimmed.startsWith("#")) {
				continue
			}

			// Check indentation
			const indent = line.length - line.trimStart().length
			const lastIndent = indentStack[indentStack.length - 1]

			if (indent > lastIndent) {
				// Increased indentation
				if (indent - lastIndent !== 4 && indent - lastIndent !== 2) {
					warnings.push(`Line ${i + 1}: Inconsistent indentation (expected 2 or 4 spaces)`)
				}
				indentStack.push(indent)
			} else if (indent < lastIndent) {
				// Decreased indentation
				while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
					indentStack.pop()
				}
				if (indentStack[indentStack.length - 1] !== indent) {
					errors.push(`Line ${i + 1}: Dedentation mismatch`)
				}
			}

			// Check for unclosed brackets
			const openBrackets = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
			const openBraces = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
			const openBrackets2 = (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length

			if (openBrackets !== 0 || openBraces !== 0 || openBrackets2 !== 0) {
				warnings.push(`Line ${i + 1}: Unclosed brackets detected`)
			}
		}

		return { errors, warnings }
	}

	/**
	 * Validate JavaScript syntax
	 */
	private validateJavaScriptSyntax(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// Basic JavaScript syntax checks
		const lines = content.split("\n")

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const trimmed = line.trim()

			// Skip empty lines and comments
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
				continue
			}

			// Check for semicolon usage (basic check)
			if (
				trimmed &&
				!trimmed.endsWith("{") &&
				!trimmed.endsWith("}") &&
				!trimmed.endsWith(";") &&
				!trimmed.includes("if ") &&
				!trimmed.includes("for ") &&
				!trimmed.includes("while ") &&
				!trimmed.includes("function ") &&
				!trimmed.includes("=>") &&
				!trimmed.includes("}")
			) {
				warnings.push(`Line ${i + 1}: Missing semicolon`)
			}

			// Check for unclosed brackets
			const openParens = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
			const openBraces = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
			const openBrackets = (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length

			if (openParens !== 0 || openBraces !== 0 || openBrackets !== 0) {
				warnings.push(`Line ${i + 1}: Unclosed brackets detected`)
			}
		}

		return { errors, warnings }
	}

	/**
	 * Validate TypeScript syntax
	 */
	private validateTypeScriptSyntax(content: string): { errors: string[]; warnings: string[] } {
		// Similar to JavaScript but with additional TypeScript-specific checks
		const result = this.validateJavaScriptSyntax(content)

		// Add TypeScript-specific validations
		const lines = content.split("\n")
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			// Check for type annotations
			if (line.includes(":") && !line.includes("=>") && !line.includes("?:")) {
				// Basic type annotation check
				const typeMatch = line.match(/:\s*([a-zA-Z0-9_<>|[\]]+)/)
				if (
					typeMatch &&
					!["string", "number", "boolean", "void", "any", "unknown", "never"].includes(typeMatch[1])
				) {
					// Could be a custom type, this is just a basic check
				}
			}
		}

		return result
	}

	/**
	 * Validate XML syntax
	 */
	private validateXMLSyntax(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		try {
			// Basic XML validation
			const openTags: string[] = []
			const lines = content.split("\n")

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]

				// Find all tags
				const tagMatches = line.matchAll(/<[^>]+>/g)

				for (const match of tagMatches) {
					const tag = match[0]

					if (tag.startsWith("</")) {
						// Closing tag
						const tagName = tag.slice(2, -1)
						if (openTags.length === 0 || openTags[openTags.length - 1] !== tagName) {
							errors.push(`Line ${i + 1}: Unexpected closing tag </${tagName}>`)
						} else {
							openTags.pop()
						}
					} else if (tag.endsWith("/>")) {
						// Self-closing tag, no need to track
					} else if (!tag.startsWith("<?") && !tag.startsWith("<!")) {
						// Opening tag
						const tagName = tag.slice(1).split(" ")[0].replace(">", "")
						openTags.push(tagName)
					}
				}
			}

			// Check for unclosed tags
			for (const unclosedTag of openTags) {
				errors.push(`Unclosed tag: <${unclosedTag}>`)
			}
		} catch (error) {
			errors.push(`XML validation failed: ${error}`)
		}

		return { errors, warnings }
	}

	/**
	 * Validate JSON syntax
	 */
	private validateJSONSyntax(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		try {
			JSON.parse(content)
		} catch (error) {
			errors.push(`JSON syntax error: ${error}`)
		}

		return { errors, warnings }
	}

	/**
	 * Generic syntax validation
	 */
	private validateGenericSyntax(content: string): { errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []

		// Basic bracket matching
		const lines = content.split("\n")
		let openParens = 0
		let openBraces = 0
		let openBrackets = 0

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			openParens += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
			openBraces += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
			openBrackets += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length

			if (openParens < 0) errors.push(`Line ${i + 1}: Unmatched closing parenthesis`)
			if (openBraces < 0) errors.push(`Line ${i + 1}: Unmatched closing brace`)
			if (openBrackets < 0) errors.push(`Line ${i + 1}: Unmatched closing bracket`)
		}

		if (openParens > 0) errors.push(`${openParens} unclosed parentheses`)
		if (openBraces > 0) errors.push(`${openBraces} unclosed braces`)
		if (openBrackets > 0) errors.push(`${openBrackets} unclosed brackets`)

		return { errors, warnings }
	}

	/**
	 * Apply search replace (helper method)
	 */
	private applySearchReplace(content: string, search: string, replace: string): string {
		if (content.includes(search)) {
			return content.replace(search, replace)
		}
		throw new Error("Search content not found")
	}

	/**
	 * Apply insert (helper method)
	 */
	private applyInsert(content: string, insertText: string, position: "before" | "after", anchor: string): string {
		const anchorIndex = content.indexOf(anchor)
		if (anchorIndex === -1) {
			throw new Error(`Anchor text not found: ${anchor}`)
		}

		const insertIndex = position === "before" ? anchorIndex : anchorIndex + anchor.length
		return content.slice(0, insertIndex) + insertText + content.slice(insertIndex)
	}

	/**
	 * Apply delete (helper method)
	 */
	private applyDelete(content: string, searchText: string): string {
		if (content.includes(searchText)) {
			return content.replace(searchText, "")
		}
		throw new Error("Delete content not found")
	}

	/**
	 * Store pending edits for UI visualization
	 */
	storePendingEdits(filePath: string, edits: PendingEdit[]): void {
		this.pendingEdits.set(filePath, edits)
	}

	/**
	 * Get pending edits for a file
	 */
	getPendingEdits(filePath: string): PendingEdit[] {
		return this.pendingEdits.get(filePath) || []
	}

	/**
	 * Clear pending edits for a file
	 */
	clearPendingEdits(filePath: string): void {
		this.pendingEdits.delete(filePath)
	}

	/**
	 * Update edit status
	 */
	updateEditStatus(filePath: string, editId: string, status: "accepted" | "rejected"): void {
		const edits = this.pendingEdits.get(filePath)
		if (edits) {
			const edit = edits.find((e) => e.id === editId)
			if (edit) {
				edit.status = status
			}
		}
	}
}
