import * as vscode from "vscode"
import type { AutocompleteCodeSnippet } from "../continuedev/core/autocomplete/snippets/types"
import type {
	Position,
	Range,
	RangeInFile,
	TabAutocompleteOptions as CoreTabAutocompleteOptions,
} from "../continuedev/core"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { ContextRetrievalService } from "../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { GhostModel } from "./GhostModel"

export interface ResponseMetaData {
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

export interface GhostSuggestionContext {
	document: vscode.TextDocument
	range?: vscode.Range | vscode.Selection
	recentlyVisitedRanges?: AutocompleteCodeSnippet[]
	recentlyEditedRanges?: RecentlyEditedRange[]
}

export interface GhostTabAutocompleteExtensions {
	template?: string
	useOtherFiles?: boolean
	recentlyEditedSimilarityThreshold?: number
	maxSnippetTokens?: number
}

export type TabAutocompleteOptions = Partial<CoreTabAutocompleteOptions> & GhostTabAutocompleteExtensions

export interface RecentlyEditedRange extends RangeInFile {
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

export type { AutocompleteCodeSnippet }

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

export interface PromptResult {
	systemPrompt: string
	userPrompt: string
	prefix: string
	suffix: string
	completionId: string
}

// ============================================================================
// FIM/Hole Filler Completion Types
// ============================================================================

export interface FillInAtCursorSuggestion {
	text: string
	prefix: string
	suffix: string
}

export interface MatchingSuggestionResult {
	text: string
	matchType: CacheMatchType
}

export interface LLMRetrievalResult extends ResponseMetaData {
	suggestion: FillInAtCursorSuggestion
}

export interface ChatCompletionResult extends ResponseMetaData {
	suggestion: FillInAtCursorSuggestion
}

export interface FimCompletionResult extends ResponseMetaData {
	suggestion: FillInAtCursorSuggestion
}

export interface FimGhostPrompt {
	strategy: "fim"
	autocompleteInput: AutocompleteInput
	formattedPrefix: string
	prunedSuffix: string
}

export interface HoleFillerGhostPrompt {
	strategy: "hole_filler"
	autocompleteInput: AutocompleteInput
	systemPrompt: string
	userPrompt: string
}

export type GhostPrompt = FimGhostPrompt | HoleFillerGhostPrompt

export interface GhostStatusBarStateProps {
	enabled?: boolean
	snoozed?: boolean
	model?: string
	provider?: string
	profileName?: string | null
	hasValidToken: boolean
	totalSessionCost: number
	completionCount: number
	sessionStartTime: number
}

export interface AutocompleteContext {
	languageId: string
	modelId?: string
	provider?: string
	strategy?: "fim" | "hole_filler"
}

export type CacheMatchType = "exact" | "partial_typing" | "backward_deletion"

export type CostTrackingCallback = (cost: number, inputTokens: number, outputTokens: number) => void

/**
 * Information about the last suggestion shown to the user.
 * Used for telemetry tracking when suggestions are accepted.
 */
export interface LastSuggestionInfo extends AutocompleteContext {
	length: number
}

export interface PendingRequest {
	prefix: string
	suffix: string
	promise: Promise<void>
}

// ============================================================================
// Visible Code Context Types
// ============================================================================

/**
 * Visible range in an editor viewport
 */
export interface VisibleRange {
	startLine: number
	endLine: number
	content: string
}

/**
 * Diff metadata for git-backed editors
 */
export interface DiffInfo {
	/** The URI scheme (e.g., "git", "gitfs") */
	scheme: string
	/** Whether this is the "old" (left) or "new" (right) side of a diff */
	side: "old" | "new"
	/** Git reference if available (e.g., "HEAD", "HEAD~1", commit hash) */
	gitRef?: string
	/** The actual file path being compared */
	originalPath: string
}

/**
 * Information about a visible editor
 */
export interface VisibleEditorInfo {
	/** Absolute file path */
	filePath: string
	/** Path relative to workspace */
	relativePath: string
	/** Language identifier (e.g., "typescript", "python") */
	languageId: string
	/** Whether this is the active editor */
	isActive: boolean
	/** The visible line ranges in the editor viewport */
	visibleRanges: VisibleRange[]
	/** Current cursor position, or null if no cursor */
	cursorPosition: Position | null
	/** All selections in the editor */
	selections: Range[]
	/** Diff information if this editor is part of a diff view */
	diffInfo?: DiffInfo
}

/**
 * Context of all visible code in editors
 */
export interface VisibleCodeContext {
	/** Timestamp when the context was captured */
	timestamp: number
	/** Information about all visible editors */
	editors: VisibleEditorInfo[]
}

// ============================================================================
// Chat Text Area Autocomplete Types
// ============================================================================

/**
 * Request for chat text area completion
 */
export interface ChatCompletionRequest {
	text: string
}

/**
 * Result of chat text area completion (distinct from code editor ChatCompletionResult)
 */
export interface ChatTextCompletionResult {
	suggestion: string
	requestId: string
}

// ============================================================================
// Conversion Utilities
// ============================================================================

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

export interface GhostContextProvider {
	contextService: ContextRetrievalService
	ide: VsCodeIde
	model: GhostModel
	ignoreController?: Promise<RooIgnoreController>
}
