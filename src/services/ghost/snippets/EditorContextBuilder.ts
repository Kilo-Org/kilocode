import * as vscode from "vscode"
import { GhostCodeSnippet, RecentlyEditedRange } from "./types"
import { EditorContextSnapshot, EditorContextSnapshotParams } from "./EditorContextSnapshot"
import { EditorContextAnalyzer, CONTEXT_EXPANSION_PRESETS } from "./EditorContextAnalyzer"
import { ContextExpansionOptions } from "../utils/tokenHelpers"

/**
 * Builder for creating EditorContextSnapshot with optional enrichment
 * Provides a fluent interface for constructing editor context with various data sources
 */
export class EditorContextBuilder {
	private recentlyEditedRanges: RecentlyEditedRange[] = []
	private recentlyVisitedSnippets: GhostCodeSnippet[] = []
	private contextOptions?: ContextExpansionOptions

	private constructor(
		private document: vscode.TextDocument,
		private range: vscode.Range,
	) {}

	/**
	 * Create builder from VSCode context
	 */
	static fromVSCode(document: vscode.TextDocument, range: vscode.Range): EditorContextBuilder {
		return new EditorContextBuilder(document, range)
	}

	/**
	 * Add recently edited ranges to the context
	 */
	withRecentEdits(ranges: RecentlyEditedRange[]): EditorContextBuilder {
		this.recentlyEditedRanges = ranges
		return this
	}

	/**
	 * Add recently visited code snippets to the context
	 */
	withVisitedSnippets(snippets: GhostCodeSnippet[]): EditorContextBuilder {
		this.recentlyVisitedSnippets = snippets
		return this
	}

	/**
	 * Add a single recently edited range
	 */
	addRecentEdit(range: RecentlyEditedRange): EditorContextBuilder {
		this.recentlyEditedRanges.push(range)
		return this
	}

	/**
	 * Add a single recently visited snippet
	 */
	addVisitedSnippet(snippet: GhostCodeSnippet): EditorContextBuilder {
		this.recentlyVisitedSnippets.push(snippet)
		return this
	}

	/**
	 * Configure context expansion options for token-aware analysis
	 */
	withContextExpansion(options: Partial<ContextExpansionOptions>): EditorContextBuilder {
		this.contextOptions = {
			...CONTEXT_EXPANSION_PRESETS.MERCURY,
			...options,
		}
		return this
	}

	/**
	 * Use Mercury Coder optimized context expansion
	 */
	forMercuryCoder(): EditorContextBuilder {
		return this.withContextExpansion(CONTEXT_EXPANSION_PRESETS.MERCURY)
	}

	/**
	 * Use balanced context expansion for general models
	 */
	balanced(): EditorContextBuilder {
		return this.withContextExpansion(CONTEXT_EXPANSION_PRESETS.BALANCED)
	}

	/**
	 * Use conservative context expansion for smaller models
	 */
	conservative(): EditorContextBuilder {
		return this.withContextExpansion(CONTEXT_EXPANSION_PRESETS.CONSERVATIVE)
	}

	/**
	 * Build the final EditorContextSnapshot
	 */
	build(): EditorContextSnapshot {
		const params: EditorContextSnapshotParams = {
			document: this.document,
			range: this.range,
			recentlyEditedRanges: this.recentlyEditedRanges,
			recentlyVisitedSnippets: this.recentlyVisitedSnippets,
		}
		return new EditorContextSnapshot(params)
	}

	/**
	 * Build with enhanced context analysis
	 */
	buildWithAnalysis(): {
		context: EditorContextSnapshot
		analysis: ReturnType<typeof EditorContextAnalyzer.getCursorContext>
		contextualText: string
		editableRegion: ReturnType<typeof EditorContextAnalyzer.getOptimalEditableRegion>
	} {
		const context = this.build()
		const analysis = EditorContextAnalyzer.getCursorContext(context)
		const contextualText = EditorContextAnalyzer.getContextualText(context, this.contextOptions)
		const editableRegion = EditorContextAnalyzer.getOptimalEditableRegion(context, this.contextOptions)

		return {
			context,
			analysis,
			contextualText,
			editableRegion,
		}
	}

	/**
	 * Legacy compatibility method - creates HelperVars-style instance
	 * @deprecated Use build() instead
	 */
	buildLegacy(): EditorContextSnapshot {
		return this.build()
	}
}

/**
 * Quick factory function for simple cases
 */
export function createEditorContext(
	document: vscode.TextDocument,
	range: vscode.Range,
	recentlyEditedRanges?: RecentlyEditedRange[],
	recentlyVisitedSnippets?: GhostCodeSnippet[],
): EditorContextSnapshot {
	return EditorContextBuilder.fromVSCode(document, range)
		.withRecentEdits(recentlyEditedRanges || [])
		.withVisitedSnippets(recentlyVisitedSnippets || [])
		.build()
}

/**
 * Factory for Mercury Coder optimized context
 */
export function createMercuryContext(
	document: vscode.TextDocument,
	range: vscode.Range,
	recentlyEditedRanges?: RecentlyEditedRange[],
	recentlyVisitedSnippets?: GhostCodeSnippet[],
): {
	context: EditorContextSnapshot
	contextualText: string
	editableRegion: ReturnType<typeof EditorContextAnalyzer.getOptimalEditableRegion>
} {
	const builder = EditorContextBuilder.fromVSCode(document, range)
		.withRecentEdits(recentlyEditedRanges || [])
		.withVisitedSnippets(recentlyVisitedSnippets || [])
		.forMercuryCoder()

	const { context, contextualText, editableRegion } = builder.buildWithAnalysis()

	return { context, contextualText, editableRegion }
}
