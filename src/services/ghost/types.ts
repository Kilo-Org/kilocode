import * as vscode from "vscode"
import type { AutocompleteCodeSnippet } from "../continuedev/core/autocomplete/snippets/types"

export interface GhostSuggestionContext {
	document: vscode.TextDocument
	range?: vscode.Range | vscode.Selection
	recentlyVisitedRanges?: AutocompleteCodeSnippet[] // Recently visited code snippets for context
	recentlyEditedRanges?: RecentlyEditedRange[] // Recently edited ranges for context
}

// ============================================================================
// CompletionProvider-compatible types (duplicated to avoid coupling)
// ============================================================================

/**
 * Position in a file (line and character)
 * Duplicated from continuedev/core to avoid coupling
 */
export interface Position {
	line: number
	character: number
}

/**
 * Range in a file
 * Duplicated from continuedev/core to avoid coupling
 */
export interface Range {
	start: Position
	end: Position
}

/**
 * Range with file path
 * Duplicated from continuedev/core to avoid coupling
 */
export interface RangeInFile {
	filepath: string
	range: Range
}

/**
 * Tab autocomplete options
 * Duplicated from continuedev/core to avoid coupling
 */
export interface TabAutocompleteOptions {
	disable: boolean
	maxPromptTokens: number
	debounceDelay: number
	modelTimeout: number
	maxSuffixPercentage: number
	prefixPercentage: number
	transform?: boolean
	multilineCompletions: "always" | "never" | "auto"
	slidingWindowPrefixPercentage: number
	slidingWindowSize: number
	useCache?: boolean
	onlyMyCode?: boolean
	template?: string
	useOtherFiles?: boolean
	useRecentlyEdited?: boolean
	recentlyEditedSimilarityThreshold?: number
	maxSnippetTokens?: number
	disableInFiles?: string[]
}

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
 * Convert VSCode Position to our Position type
 */
export function vscodePositionToPosition(pos: vscode.Position): Position {
	return {
		line: pos.line,
		character: pos.character,
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
		pos: vscodePositionToPosition(position),
		recentlyVisitedRanges,
		recentlyEditedRanges,
		manuallyPassFileContents: undefined,
		manuallyPassPrefix: prefix,
	}
}
