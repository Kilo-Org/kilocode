import * as vscode from "vscode"
import type { AutocompleteCodeSnippet } from "../continuedev/core/autocomplete/snippets/types"
import type {
	Position,
	Range,
	RangeInFile,
	TabAutocompleteOptions as CoreTabAutocompleteOptions,
} from "../continuedev/core"

export interface GhostSuggestionContext {
	document: vscode.TextDocument
	range?: vscode.Range | vscode.Selection
	recentlyVisitedRanges?: AutocompleteCodeSnippet[] // Recently visited code snippets for context
	recentlyEditedRanges?: RecentlyEditedRange[] // Recently edited ranges for context
}

/**
 * Ghost-specific extensions to TabAutocompleteOptions
 */
export interface GhostTabAutocompleteExtensions {
	template?: string
	useOtherFiles?: boolean
	recentlyEditedSimilarityThreshold?: number
	maxSnippetTokens?: number
}

/**
 * Tab autocomplete options for Ghost
 * Based on CoreTabAutocompleteOptions with some fields made optional and ghost-specific extensions
 */
export type TabAutocompleteOptions = Partial<CoreTabAutocompleteOptions> & GhostTabAutocompleteExtensions

/**
 * Recently edited range with timestamp
 * Duplicated from continuedev/core to avoid coupling
 */
export interface RecentlyEditedRange extends RangeInFile {
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

/**
 * Code snippet for autocomplete context
 * Re-exported from continuedev/core for compatibility
 */
export type { AutocompleteCodeSnippet }

/**
 * Input for autocomplete request (CompletionProvider-compatible)
 * Duplicated from continuedev/core to avoid coupling
 */
export interface AutocompleteInput {
	isUntitledFile: boolean
	completionId: string
	filepath: string
	pos: Position
	recentlyVisitedRanges: AutocompleteCodeSnippet[]
	recentlyEditedRanges: RecentlyEditedRange[]
	manuallyPassFileContents?: string
	manuallyPassPrefix?: string
	selectedCompletionInfo?: {
		text: string
		range: Range
	}
	injectDetails?: string
}

/**
 * Output from autocomplete request (CompletionProvider-compatible)
 * Duplicated from continuedev/core to avoid coupling
 */
export interface AutocompleteOutcome extends TabAutocompleteOptions {
	accepted?: boolean
	time: number
	prefix: string
	suffix: string
	prompt: string
	completion: string
	modelProvider: string
	modelName: string
	completionOptions: Record<string, unknown>
	cacheHit: boolean
	numLines: number
	filepath: string
	gitRepo?: string
	completionId: string
	uniqueId: string
	timestamp: string
	enabledStaticContextualization?: boolean
	profileType?: "local" | "platform" | "control-plane"
}

/**
 * Result from prompt generation including prefix/suffix
 * New interface for Ghost to align with CompletionProvider
 */
export interface PromptResult {
	systemPrompt: string
	userPrompt: string
	prefix: string
	suffix: string
	completionId: string
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Extract prefix and suffix from a document at a given position
 */
export function extractPrefixSuffix(
	document: vscode.TextDocument,
	position: vscode.Position,
): { prefix: string; suffix: string } {
	const offset = document.offsetAt(position)
	const text = document.getText()

	return {
		prefix: text.substring(0, offset),
		suffix: text.substring(offset),
	}
}

/**
 * Convert GhostSuggestionContext to AutocompleteInput
 */
export function contextToAutocompleteInput(context: GhostSuggestionContext): AutocompleteInput {
	const position = context.range?.start ?? context.document.positionAt(0)
	const { prefix, suffix } = extractPrefixSuffix(context.document, position)

	// Get recently visited and edited ranges from context, with empty arrays as fallback
	const recentlyVisitedRanges = context.recentlyVisitedRanges ?? []
	const recentlyEditedRanges = context.recentlyEditedRanges ?? []

	return {
		isUntitledFile: context.document.isUntitled,
		completionId: crypto.randomUUID(),
		filepath: context.document.uri.fsPath,
		pos: { line: position.line, character: position.character },
		recentlyVisitedRanges,
		recentlyEditedRanges,
		manuallyPassFileContents: undefined,
		manuallyPassPrefix: prefix,
	}
}
