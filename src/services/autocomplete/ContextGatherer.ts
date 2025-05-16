import * as vscode from "vscode"
import { KiloCodeIDEAdapter } from "./KiloCodeIDEAdapter"

/**
 * Interface for code context
 */
export interface CodeContext {
	currentLine: string
	precedingLines: string[]
	followingLines: string[]
	imports: string[]
	definitions: {
		filepath: string
		content: string
		range: {
			start: { line: number; character: number }
			end: { line: number; character: number }
		}
	}[]
}

/**
 * Gathers relevant code context for autocomplete
 */
export class ContextGatherer {
	private ide: KiloCodeIDEAdapter
	private maxPrecedingLines: number
	private maxFollowingLines: number
	private maxImports: number
	private maxDefinitions: number

	/**
	 * Create a new context gatherer
	 * @param ide IDE adapter
	 * @param maxPrecedingLines Maximum number of preceding lines to include
	 * @param maxFollowingLines Maximum number of following lines to include
	 * @param maxImports Maximum number of imports to include
	 * @param maxDefinitions Maximum number of definitions to include
	 */
	constructor(
		ide: KiloCodeIDEAdapter,
		maxPrecedingLines: number = 20,
		maxFollowingLines: number = 10,
		maxImports: number = 20,
		maxDefinitions: number = 5,
	) {
		this.ide = ide
		this.maxPrecedingLines = maxPrecedingLines
		this.maxFollowingLines = maxFollowingLines
		this.maxImports = maxImports
		this.maxDefinitions = maxDefinitions
	}

	/**
	 * Gather context for autocomplete
	 * @param document Current document
	 * @param position Cursor position
	 * @param useImports Whether to include imports
	 * @param useDefinitions Whether to include definitions
	 * @returns Code context
	 */
	async gatherContext(
		document: vscode.TextDocument,
		position: vscode.Position,
		useImports: boolean = true,
		useDefinitions: boolean = true,
	): Promise<CodeContext> {
		const content = document.getText()
		const lines = content.split("\n")
		const currentLine = lines[position.line]

		// Get preceding lines
		const precedingLines = lines
			.slice(Math.max(0, position.line - this.maxPrecedingLines), position.line)
			.filter((line) => line.trim().length > 0)

		// Get following lines
		const followingLines = lines
			.slice(position.line + 1, position.line + 1 + this.maxFollowingLines)
			.filter((line) => line.trim().length > 0)

		// Get imports
		let imports: string[] = []
		if (useImports) {
			imports = await this.extractImports(document)
		}

		// Get definitions
		let definitions: CodeContext["definitions"] = []
		if (useDefinitions) {
			definitions = await this.getDefinitions(document, position)
		}

		return {
			currentLine,
			precedingLines,
			followingLines,
			imports,
			definitions,
		}
	}

	/**
	 * Extract imports from the document
	 * @param document Document to extract imports from
	 * @returns Array of import statements
	 */
	private async extractImports(document: vscode.TextDocument): Promise<string[]> {
		const content = document.getText()
		const lines = content.split("\n")
		const imports: string[] = []

		// Simple regex patterns for different import styles
		const importPatterns = [
			/^\s*import\s+.*?from\s+['"].*?['"]/, // ES6 imports
			/^\s*import\s+['"].*?['"]/, // Side-effect imports
			/^\s*const\s+.*?\s*=\s*require\(['"].*?['"]\)/, // CommonJS require
			/^\s*from\s+['"].*?['"]/, // Python imports
			/^\s*using\s+.*;/, // C# using
			/^\s*#include\s+[<"].*?[>"]/, // C/C++ include
		]

		for (const line of lines) {
			if (importPatterns.some((pattern) => pattern.test(line))) {
				imports.push(line.trim())

				if (imports.length >= this.maxImports) {
					break
				}
			}
		}

		return imports
	}

	/**
	 * Get definitions for the current position
	 * @param document Document
	 * @param position Position
	 * @returns Array of definitions
	 */
	private async getDefinitions(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<CodeContext["definitions"]> {
		try {
			// Use VSCode's definition provider
			const uri = document.uri

			const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
				"vscode.executeDefinitionProvider",
				uri,
				position,
			)

			if (!definitions || definitions.length === 0) {
				return []
			}

			const result: CodeContext["definitions"] = []

			for (const def of definitions.slice(0, this.maxDefinitions)) {
				try {
					const defDocument = await vscode.workspace.openTextDocument(def.uri)
					const content = defDocument.getText(def.range)

					result.push({
						filepath: def.uri.toString(),
						content,
						range: {
							start: {
								line: def.range.start.line,
								character: def.range.start.character,
							},
							end: {
								line: def.range.end.line,
								character: def.range.end.character,
							},
						},
					})
				} catch (error) {
					console.error(`Error getting definition content: ${error}`)
				}
			}

			return result
		} catch (error) {
			console.error(`Error getting definitions: ${error}`)
			return []
		}
	}
}
