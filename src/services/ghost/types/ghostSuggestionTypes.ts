import { DiffLine } from "../utils/myers"
import { SnippetPayload } from "../snippets/types"
import { GhostCodeSnippet } from "../snippets/types"
import { EditorContextSnapshot } from "../snippets/EditorContextSnapshot"
import { GhostSuggestionOutcome } from "../types/GhostSuggestionOutcome"

// Position, Range, RangeInFile from VSCode types
export interface Position {
	line: number
	character: number
}

export interface Range {
	start: Position
	end: Position
}

export interface RangeInFile {
	filepath: string
	range: Range
}

export type RecentlyEditedRange = RangeInFile & {
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

export interface AutocompleteInput {
	isUntitledFile: boolean
	completionId: string
	filepath: string
	pos: Position
	recentlyVisitedRanges: GhostCodeSnippet[]
	recentlyEditedRanges: RecentlyEditedRange[]
	// Used for notebook files
	manuallyPassFileContents?: string
	// Used for VS Code git commit input box
	manuallyPassPrefix?: string
	selectedCompletionInfo?: {
		text: string
		range: Range
	}
	injectDetails?: string
}

// GhostSuggestionOutcome moved to types/GhostSuggestionOutcome.ts for consolidation

export interface PromptMetadata {
	prompt: UserPrompt
	userEdits: string
	userExcerpts: string
}

export type Prompt = SystemPrompt | UserPrompt

export interface SystemPrompt {
	role: "system"
	content: string
}

export interface UserPrompt {
	role: "user"
	content: string
}

export interface GhostSuggestionTemplate {
	template: string
}

export interface MercuryTemplateVars {
	recentlyViewedCodeSnippets: string
	currentFileContent: string
	editDiffHistory: string // could be a singe large unified diff
	currentFilePath: string
}

/**
 * Context object containing all necessary information for model-specific operations.
 */
export interface ModelSpecificContext {
	helper: EditorContextSnapshot
	snippetPayload: SnippetPayload
	editableRegionStartLine: number
	editableRegionEndLine: number
	diffContext: string[]
	ghostContext: string
	historyDiff?: string
	workspaceDirs?: string[]
}

/**
 * Configuration for editable region calculation.
 */
export interface EditableRegionConfig {
	usingFullFileDiff?: boolean
	maxTokens?: number
	topMargin?: number
	bottomMargin?: number
}

/**
 * Configuration for prompt generation.
 */
export interface PromptConfig {
	includeHistory?: boolean
	includeRecentEdits?: boolean
	maxContextSnippets?: number
}

export interface DiffGroup {
	startLine: number
	endLine: number
	lines: DiffLine[]
	type?: string // Optional classification of the group
}

export interface ProcessedItem {
	location: RangeInFile
	outcome: GhostSuggestionOutcome // Result from the model
}
