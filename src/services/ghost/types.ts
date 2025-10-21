import * as vscode from "vscode"

/**
 * Represents the type of user action performed on a document
 */
export enum UserActionType {
	ADDITION = "ADDITION", // Added new code
	DELETION = "DELETION", // Removed existing code
	MODIFICATION = "MODIFICATION", // Changed existing code
	REFACTOR = "REFACTOR", // Renamed or moved code
	FORMAT = "FORMAT", // Changed formatting without semantic changes
}

/**
 * Represents a meaningful user action performed on a document
 */
export interface UserAction {
	type: UserActionType
	description: string
	lineRange?: {
		start: number
		end: number
	}
	affectedSymbol?: string // Function/variable/class name if applicable
	scope?: string // Function/class/namespace containing the change
	timestamp?: number // When the action occurred
	content?: string // The actual content that was added, deleted, or modified
}

export interface GhostDocumentStoreItem {
	uri: string
	document: vscode.TextDocument
	history: string[]
	lastParsedVersion?: number
	recentActions?: UserAction[]
}

export type GhostSuggestionEditOperationType = "+" | "-"

export interface GhostSuggestionEditOperation {
	type: GhostSuggestionEditOperationType
	line: number
	oldLine: number
	newLine: number
	content: string
}

export interface GhostSuggestionEditOperationsOffset {
	added: number
	removed: number
	offset: number
}

export interface GhostSuggestionContext {
	document: vscode.TextDocument
	editor?: vscode.TextEditor
	openFiles?: vscode.TextDocument[]
	range?: vscode.Range | vscode.Selection
	userInput?: string
	recentOperations?: UserAction[] // Stores meaningful user actions instead of raw diff
	diagnostics?: vscode.Diagnostic[] // Document diagnostics (errors, warnings, etc.)
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
 * Duplicated from continuedev/core to avoid coupling
 */
export interface AutocompleteCodeSnippet extends RangeInFile {
	content: string
	score?: number
}

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
	completionOptions: any
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
 * Convert VSCode Range to our Range type
 */
export function vscodeRangeToRange(range: vscode.Range): Range {
	return {
		start: vscodePositionToPosition(range.start),
		end: vscodePositionToPosition(range.end),
	}
}

/**
 * Convert GhostSuggestionContext to AutocompleteInput
 */
export function contextToAutocompleteInput(context: GhostSuggestionContext): AutocompleteInput {
	const position = context.range?.start ?? context.document.positionAt(0)
	const { prefix, suffix } = extractPrefixSuffix(context.document, position)

	// Convert recent operations to recently edited ranges
	const recentlyEditedRanges: RecentlyEditedRange[] =
		context.recentOperations?.map((op) => {
			const range: Range = op.lineRange
				? {
						start: { line: op.lineRange.start, character: 0 },
						end: { line: op.lineRange.end, character: 0 },
					}
				: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 0 },
					}

			return {
				filepath: context.document.uri.fsPath,
				range,
				timestamp: op.timestamp ?? Date.now(),
				lines: op.content ? op.content.split("\n") : [],
				symbols: new Set(op.affectedSymbol ? [op.affectedSymbol] : []),
			}
		}) ?? []

	return {
		isUntitledFile: context.document.isUntitled,
		completionId: crypto.randomUUID(),
		filepath: context.document.uri.fsPath,
		pos: vscodePositionToPosition(position),
		recentlyVisitedRanges: [], // Not tracked in current Ghost implementation
		recentlyEditedRanges,
		manuallyPassFileContents: undefined,
		manuallyPassPrefix: prefix,
	}
}
