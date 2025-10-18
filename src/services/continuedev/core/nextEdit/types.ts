import { DiffLine, RangeInFile, TabAutocompleteOptions } from "../"
import { SnippetPayload } from "../autocomplete/snippets"
import { HelperVars } from "../autocomplete/util/HelperVars"

export type RecentlyEditedRange = RangeInFile & {
	timestamp: number
	lines: string[]
	symbols: Set<string>
}

export interface NextEditOutcome extends TabAutocompleteOptions {
	// Originally from Autocomplete.
	// accepted?: boolean;
	elapsed: number
	// prefix: string;
	// suffix: string;
	// prompt: string;
	// completion: string;
	modelProvider: string
	modelName: string
	completionOptions: any
	// cacheHit: boolean;
	// numLines: number;
	// filepath: string;
	completionId: string
	gitRepo?: string
	uniqueId: string
	requestId?: string
	timestamp: number

	// New for Next Edit.
	fileUri: string
	workspaceDirUri: string
	prompt: string
	userEdits: string
	userExcerpts: string
	originalEditableRange: string
	completion: string
	cursorPosition: { line: number; character: number }
	finalCursorPosition: { line: number; character: number }
	accepted?: boolean
	aborted?: boolean
	editableRegionStartLine: number
	editableRegionEndLine: number
	diffLines: DiffLine[]
	profileType?: "local" | "platform" | "control-plane"
}

export interface PromptMetadata {
	prompt: UserPrompt
	userEdits: string
	userExcerpts: string
}

export type Prompt = SystemPrompt | UserPrompt

interface SystemPrompt {
	role: "system"
	content: string
}

interface UserPrompt {
	role: "user"
	content: string
}

export interface TemplateVars {
	recentlyViewedCodeSnippets?: string
	currentFileContent?: string
	editDiffHistory?: string
	contextSnippets?: string
	currentFilePath?: string
	languageShorthand: string
}

/**
 * Context object containing all necessary information for model-specific operations.
 */
export interface ModelSpecificContext {
	helper: HelperVars
	snippetPayload: SnippetPayload
	editableRegionStartLine: number
	editableRegionEndLine: number
	diffContext: string[]
	autocompleteContext: string
	historyDiff?: string
	workspaceDirs?: string[]
}
