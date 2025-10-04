/**
 * Import Definitions Service
 * Simplified version of Continue's ImportDefinitionsService.ts for symbol resolution
 * Adapted for VSCode without full tree-sitter dependency
 */

import * as vscode from "vscode"
import { GhostCodeSnippet, GhostSnippetType } from "./types"
import { EditorContextSnapshot } from "./EditorContextSnapshot"
import { getSymbolsForSnippet } from "./ranking"

interface FileInfo {
	imports: { [key: string]: Array<{ filepath: string; content: string }> }
}

/**
 * Simplified ImportDefinitionsService for VSCode integration
 * Focuses on basic symbol resolution without complex tree-sitter parsing
 */
export class ImportDefinitionsService {
	private cache = new Map<string, FileInfo>()
	private maxCacheSize = 10

	constructor() {
		// Listen for file changes to invalidate cache
		vscode.workspace.onDidChangeTextDocument((event) => {
			this.cache.delete(event.document.uri.fsPath)
		})
	}

	/**
	 * Get file info with import/symbol definitions
	 */
	get(filepath: string): FileInfo | undefined {
		return this.cache.get(filepath)
	}

	/**
	 * Initialize cache for a file
	 */
	async initKey(filepath: string): Promise<void> {
		if (this.cache.has(filepath)) {
			return
		}

		try {
			const fileInfo = await this.analyzeFile(filepath)

			// Manage cache size
			if (this.cache.size >= this.maxCacheSize) {
				const firstKey = this.cache.keys().next().value
				if (firstKey) {
					this.cache.delete(firstKey)
				}
			}

			this.cache.set(filepath, fileInfo)
		} catch (error) {
			console.warn(`Failed to analyze file ${filepath}:`, error)
		}
	}

	/**
	 * Analyze file for imports and symbols (simplified approach)
	 */
	private async analyzeFile(filepath: string): Promise<FileInfo> {
		const fileInfo: FileInfo = { imports: {} }

		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath))
			const content = document.getText()

			// Simple regex-based import detection for common languages
			const imports = this.extractImports(content, document.languageId)

			// For each import, try to resolve it using VSCode's built-in capabilities
			for (const importName of imports) {
				try {
					const definitions = await this.resolveSymbol(document, importName)
					if (definitions.length > 0) {
						fileInfo.imports[importName] = definitions
					}
				} catch (error) {
					// Skip unresolvable symbols
				}
			}
		} catch (error) {
			console.warn(`Failed to read file ${filepath}:`, error)
		}

		return fileInfo
	}

	/**
	 * Extract import/symbol names from file content using simple regex patterns
	 */
	private extractImports(content: string, languageId: string): string[] {
		const imports: string[] = []

		switch (languageId) {
			case "typescript":
			case "javascript":
			case "tsx":
			case "jsx": {
				// Match import statements: import { name } from '...'
				const jsImports = content.match(/import\s+\{([^}]+)\}\s+from/g)
				if (jsImports) {
					jsImports.forEach((match) => {
						const names = match.match(/\{([^}]+)\}/)?.[1]
						if (names) {
							const symbols = names
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
							imports.push(...symbols)
						}
					})
				}

				// Match default imports: import Name from '...'
				const defaultImports = content.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from/g)
				if (defaultImports) {
					defaultImports.forEach((match) => {
						const name = match.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/)?.[1]
						if (name) {
							imports.push(name)
						}
					})
				}
				break
			}
			case "python": {
				// Match from X import Y
				const pythonImports = content.match(/from\s+[\w.]+\s+import\s+([^\n]+)/g)
				if (pythonImports) {
					pythonImports.forEach((match) => {
						const names = match.split("import")[1]?.trim()
						if (names) {
							const symbols = names
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
							imports.push(...symbols)
						}
					})
				}
				break
			}
		}

		return imports.slice(0, 20) // Limit to prevent overwhelming context
	}

	/**
	 * Resolve symbol definitions using VSCode's built-in capabilities
	 */
	private async resolveSymbol(
		document: vscode.TextDocument,
		symbolName: string,
	): Promise<Array<{ filepath: string; content: string }>> {
		try {
			// Find the symbol in the document
			const text = document.getText()
			const symbolIndex = text.indexOf(symbolName)
			if (symbolIndex === -1) {
				return []
			}

			const position = document.positionAt(symbolIndex)

			// Use VSCode's definition provider
			const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
				"vscode.executeDefinitionProvider",
				document.uri,
				position,
			)

			if (!definitions || definitions.length === 0) {
				return []
			}

			// Read content from definition locations
			const results: Array<{ filepath: string; content: string }> = []

			for (const def of definitions.slice(0, 3)) {
				// Limit to 3 definitions
				try {
					const defDocument = await vscode.workspace.openTextDocument(def.uri)
					const defContent = defDocument.getText(def.range)

					if (defContent && defContent.trim().length > 0) {
						results.push({
							filepath: def.uri.fsPath,
							content: defContent,
						})
					}
				} catch (error) {
					// Skip unreadable definitions
				}
			}

			return results
		} catch (error) {
			return []
		}
	}

	/**
	 * Get snippets from import definitions for a helper context
	 */
	async getSnippetsFromImportDefinitions(helper: EditorContextSnapshot): Promise<GhostCodeSnippet[]> {
		const snippets: GhostCodeSnippet[] = []
		const fileInfo = this.get(helper.filepath)

		if (!fileInfo) {
			return snippets
		}

		// Look for imports of symbols around the current cursor
		const symbols = Array.from(getSymbolsForSnippet(helper.textAroundCursor))
			.filter((symbol) => symbol.length > 2) // Filter out short symbols
			.slice(0, 10) // Limit search

		for (const symbol of symbols) {
			const definitions = fileInfo.imports[symbol]
			if (Array.isArray(definitions)) {
				const symbolSnippets = definitions.map((def) => ({
					filepath: def.filepath,
					content: def.content,
					type: GhostSnippetType.Code as GhostSnippetType.Code,
				}))
				snippets.push(...symbolSnippets)
			}
		}

		return snippets.slice(0, 5) // Limit total import snippets
	}
}
