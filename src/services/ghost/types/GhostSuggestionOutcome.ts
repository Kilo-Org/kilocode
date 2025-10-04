import { DiffLine } from "../utils/myers"

/**
 * GhostSuggestionOutcome interface compatible with Continue's structure.
 * This represents the complete outcome of a Ghost Suggestion operation including
 * all metadata, prompts, and diff information needed for chaining and telemetry.
 */
export interface GhostSuggestionOutcome {
	// Core completion metadata
	completionId: string
	elapsed: number
	modelProvider: string
	modelName: string
	completion: string
	completionOptions: any

	// File and workspace context
	fileUri: string
	workspaceDirUri?: string

	// Edit positioning and boundaries
	cursorPosition: { line: number; character: number }
	finalCursorPosition: { line: number; character: number }
	editableRegionStartLine: number
	editableRegionEndLine: number

	// Prompt and context information
	prompt: string
	userEdits: string
	userExcerpts: string
	originalEditableRange: string

	// Diff and change information
	diffLines: DiffLine[]

	// Status and lifecycle tracking
	accepted?: boolean
	aborted?: boolean
	timestamp: number
	uniqueId: string

	// Optional metadata
	gitRepo?: string
}

/**
 * Prompt metadata for Continue compatibility.
 * Contains structured prompt information and context.
 */
export interface PromptMetadata {
	prompt: UserPrompt
	userEdits: string
	userExcerpts: string
	originalEditableRange?: string
	editableRegionStartLine?: number
	editableRegionEndLine?: number
	cursorPosition?: { line: number; character: number }
}

/**
 * Prompt types following Continue's structure
 */
export type Prompt = SystemPrompt | UserPrompt

export interface SystemPrompt {
	role: "system"
	content: string
}

export interface UserPrompt {
	role: "user"
	content: string
}

/**
 * Configuration for editable region calculation
 */
export interface EditableRegionConfig {
	usingFullFileDiff?: boolean
	maxTokens?: number
	topMargin?: number
	bottomMargin?: number
}

/**
 * Configuration for prompt generation
 */
export interface PromptConfig {
	includeHistory?: boolean
	includeRecentEdits?: boolean
	maxContextSnippets?: number
	injectUniqueToken?: boolean
}

/**
 * Template variables for Mercury Coder prompts
 */
export interface MercuryTemplateVars {
	recentlyViewedCodeSnippets: string
	currentFileContent: string
	editDiffHistory: string
	currentFilePath: string
}

/**
 * Context object containing all necessary information for model-specific operations
 */
export interface ModelSpecificContext {
	helper: any // EditorContextSnapshot equivalent in our system
	snippetPayload: any // Our snippet payload
	editableRegionStartLine: number
	editableRegionEndLine: number
	diffContext: string[]
	ghostContext: string
	historyDiff?: string
	workspaceDirs?: string[]
}

/**
 * Recently edited range for context tracking
 */
export interface RecentlyEditedRange {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

/**
 * Ghost Suggestion completion request input
 */
export interface GhostSuggestionInput {
	isUntitledFile: boolean
	completionId: string
	filepath: string
	pos: { line: number; character: number }
	recentlyVisitedRanges: any[] // AutocompleteCodeSnippet[]
	recentlyEditedRanges: RecentlyEditedRange[]
	manuallyPassFileContents?: string
	manuallyPassPrefix?: string
	selectedCompletionInfo?: {
		text: string
		range: {
			start: { line: number; character: number }
			end: { line: number; character: number }
		}
	}
	injectDetails?: string
}

/**
 * Factory method to create a GhostSuggestionOutcome with default values
 */
export function createGhostSuggestionOutcome(params: {
	completionId: string
	fileUri: string
	completion: string
	modelProvider?: string
	modelName?: string
	elapsed?: number
	cursorPosition: { line: number; character: number }
	editableRegionStartLine: number
	editableRegionEndLine: number
	diffLines: DiffLine[]
	prompt: string
	originalEditableRange: string
	userEdits?: string
	userExcerpts?: string
}): GhostSuggestionOutcome {
	const now = Date.now()

	return {
		completionId: params.completionId,
		elapsed: params.elapsed || 0,
		modelProvider: params.modelProvider || "unknown",
		modelName: params.modelName || "unknown",
		completion: params.completion,
		completionOptions: {},
		fileUri: params.fileUri,
		cursorPosition: params.cursorPosition,
		finalCursorPosition: params.cursorPosition, // Will be calculated later
		editableRegionStartLine: params.editableRegionStartLine,
		editableRegionEndLine: params.editableRegionEndLine,
		prompt: params.prompt,
		userEdits: params.userEdits || "",
		userExcerpts: params.userExcerpts || "",
		originalEditableRange: params.originalEditableRange,
		diffLines: params.diffLines,
		timestamp: now,
		uniqueId: `${params.completionId}-${now}`,
	}
}

/**
 * Utility to convert a GhostSuggestionOutcome to a summary for logging/telemetry
 */
export function summarizeGhostSuggestionOutcome(outcome: GhostSuggestionOutcome): {
	completionId: string
	elapsed: number
	modelProvider: string
	modelName: string
	fileUri: string
	numDiffLines: number
	accepted: boolean
	aborted: boolean
} {
	return {
		completionId: outcome.completionId,
		elapsed: outcome.elapsed,
		modelProvider: outcome.modelProvider,
		modelName: outcome.modelName,
		fileUri: outcome.fileUri,
		numDiffLines: outcome.diffLines.length,
		accepted: outcome.accepted || false,
		aborted: outcome.aborted || false,
	}
}
