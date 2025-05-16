/**
 * Type definitions for continue-wrapper
 * These types provide a simplified version of Continue Dev types
 */

/**
 * Represents a position in a file
 */
export interface Position {
	line: number
	character: number
}

/**
 * Represents a range in a file
 */
export interface Range {
	start: Position
	end: Position
}

/**
 * Represents a range in a specific file
 */
export interface RangeInFile {
	filepath: string
	range: Range
}

/**
 * Interface for IDE functionality
 */
export interface IDE {
	readFile(filepath: string): Promise<string>
	readRangeInFile(filepath: string, range: Range): Promise<string>
	getWorkspaceDirs(): Promise<string[]>
	getRepoName(filepath: string): Promise<string | undefined>
	getUniqueId(): Promise<string>
	getIdeInfo(): Promise<any>
	// Add other methods as needed
}

/**
 * Interface for LLM functionality
 */
export interface ILLM {
	providerName: string
	model?: string
	apiKey?: string
	completionOptions: CompletionOptions
	complete(prompt: string, signal: AbortSignal, options?: any): Promise<string>
}

/**
 * Interface for configuration handler
 */
export interface ConfigHandler {
	loadConfig(): Promise<{ config: any }>
	reloadConfig(): Promise<void>
}

/**
 * Function type for getting LSP definitions
 */
export type GetLspDefinitionsFunction = (
	filepath: string,
	contents: string,
	cursorIndex: number,
	ide: any,
	lang: any,
) => Promise<any[]>

/**
 * Input for autocomplete
 */
export interface AutocompleteInput {
	filepath: string
	pos: Position
	completionId: string
	isUntitledFile: boolean
	recentlyVisitedRanges: AutocompleteCodeSnippet[]
	recentlyEditedRanges: RecentlyEditedRange[]
	content: string
	language: string
	cursorIndex: number
}

/**
 * Outcome of autocomplete
 */
export interface AutocompleteOutcome {
	completion: string
	time: number
	prefix: string
	suffix: string
	prompt: string
	modelProvider: string
	modelName: string
	completionOptions: any
	cacheHit: boolean
	filepath: string
	numLines: number
	completionId: string
	gitRepo?: string
	uniqueId: string
	timestamp: number
	[key: string]: any
}

/**
 * Represents a code snippet used for autocomplete suggestions
 */
export interface AutocompleteCodeSnippet {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	content: string
}

/**
 * Represents a range that was recently edited
 */
export interface RecentlyEditedRange {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	timestamp: number
	content: string
}

/**
 * Basic chat message structure
 */
export interface ChatMessage {
	role: string
	content: string | any
}

/**
 * Basic completion options
 */
export interface CompletionOptions {
	model: string
	temperature?: number
	maxTokens?: number
}

/**
 * Tab autocomplete options
 */
export interface TabAutocompleteOptions {
	enabled: boolean
	model?: string
}
