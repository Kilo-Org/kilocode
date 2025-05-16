/**
 * Type definitions for continue-wrapper
 * These types are defined here to avoid dependencies on @continuedev/core
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
export interface RecentlyEditedRange extends RangeInFile {
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

/**
 * Basic LLM interface
 */
export interface ILLM {
	providerName: string
	complete(prompt: string, signal: AbortSignal, options?: any): Promise<string>
}
