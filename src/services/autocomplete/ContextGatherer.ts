//PLANREF: continue/core/autocomplete/context/ContextRetrievalService.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
import * as vscode from "vscode"
import { IDE } from "./utils/ide" // Required for new services
import { RecentlyEditedTracker } from "./context/RecentlyEditedTracker"
import { RecentlyVisitedRangesService } from "./context/RecentlyVisitedRangesService"
import { getDefinitionsFromLsp } from "./utils/lsp"
import { getLanguageInfo } from "./AutocompleteLanguageInfo" // Required for getDefinitionsFromLsp, removed unused AutocompleteLanguageInfo interface
import { RangeInFileWithContents, RecentlyEditedRange } from "./ide-types" // Removed unused IdePosition, IdeRange

/**
 * Interface for code context
 */
export interface CodeContext {
	currentLine: string
	precedingLines: string[]
	followingLines: string[]
	imports: string[] // Retained for now, can be re-evaluated
	definitions: RangeInFileWithContents[] // Updated to use common type
	recentlyEdited: {
		// Combined recently edited ranges and documents
		ranges: RecentlyEditedRange[]
		documents: RangeInFileWithContents[]
	}
	recentlyVisited: RangeInFileWithContents[]
}

/**
 * Gathers relevant code context for autocomplete
 */
export class ContextGatherer {
	private maxPrecedingLines: number
	private maxFollowingLines: number
	private maxImports: number
	// maxDefinitions might be handled differently by getDefinitionsFromLsp or internally
	// private maxDefinitions: number;

	private ide: IDE
	private recentlyEditedTracker: RecentlyEditedTracker
	private recentlyVisitedRangesService: RecentlyVisitedRangesService

	/**
	 * Create a new context gatherer
	 * @param ide IDE instance
	 * @param maxPrecedingLines Maximum number of preceding lines to include
	 * @param maxFollowingLines Maximum number of following lines to include
	 * @param maxImports Maximum number of imports to include
	 */
	constructor(
		ide: IDE,
		maxPrecedingLines: number = 20,
		maxFollowingLines: number = 10,
		maxImports: number = 20,
		// maxDefinitions: number = 5, // LSP might return a variable number
	) {
		this.ide = ide
		this.maxPrecedingLines = maxPrecedingLines
		this.maxFollowingLines = maxFollowingLines
		this.maxImports = maxImports
		// this.maxDefinitions = maxDefinitions;

		this.recentlyEditedTracker = new RecentlyEditedTracker(this.ide)
		this.recentlyVisitedRangesService = new RecentlyVisitedRangesService(this.ide)
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
		useImports: boolean = true, // Retain for now
		useDefinitions: boolean = true, // Retain for now
		// TODO: Expose config for enabling/disabling new context sources
	): Promise<CodeContext> {
		const fullContent = document.getText()
		const lines = fullContent.split("\n")
		const currentLine = lines[position.line] ?? ""
		const cursorIndex = document.offsetAt(position)

		// Get preceding lines
		const precedingLines = lines
			.slice(Math.max(0, position.line - this.maxPrecedingLines), position.line)
			.filter((line) => line.trim().length > 0)

		// Get following lines
		const followingLines = lines
			.slice(position.line + 1, position.line + 1 + this.maxFollowingLines)
			.filter((line) => line.trim().length > 0)

		// Get imports (existing method)
		let imports: string[] = []
		if (useImports) {
			imports = await this.extractImports(document)
		}

		// Get definitions using new LSP-based method
		let definitions: RangeInFileWithContents[] = []
		if (useDefinitions) {
			// Get language info using our existing function
			const langInfoForLsp = getLanguageInfo(document.languageId)
			// The getDefinitionsFromLsp function in lsp.ts currently only uses
			// lang.singleLineComment from the AutocompleteLanguageInfo type.
			// Other properties like delimiters or indentation are not used by it.
			// If they were needed, we would have to extend AutocompleteLanguageInfo or pass them separately.

			try {
				definitions = await getDefinitionsFromLsp(
					document.uri.fsPath,
					fullContent,
					cursorIndex,
					this.ide,
					langInfoForLsp, // Pass the correctly typed and named variable
				)
			} catch (e) {
				console.error("Error fetching LSP definitions:", e)
			}
		}

		// Get recently edited context
		const recentlyEditedRanges = await this.recentlyEditedTracker.getRecentlyEditedRanges()
		const recentlyEditedDocuments = await this.recentlyEditedTracker.getRecentlyEditedDocuments()

		// Get recently visited context
		const recentlyVisitedSnippets = this.recentlyVisitedRangesService.getSnippets(document.uri.fsPath)

		return {
			currentLine,
			precedingLines,
			followingLines,
			imports,
			definitions,
			recentlyEdited: {
				ranges: recentlyEditedRanges,
				documents: recentlyEditedDocuments,
			},
			recentlyVisited: recentlyVisitedSnippets,
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
	// The old getDefinitions method is replaced by the call to getDefinitionsFromLsp
	// If specific parts of the old logic are still needed, they should be integrated
	// into the new LSP handling or called separately if they serve a different purpose.
	// For now, we assume getDefinitionsFromLsp is the primary source for "definitions".
}
