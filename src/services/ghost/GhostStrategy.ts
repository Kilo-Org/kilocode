import { GhostSuggestionContext } from "./types"
import { StreamingParseResult } from "./GhostStreamingParser"

export interface IGhostStrategy {
	/**
	 * Get the system prompt based on context using the new strategy system
	 * Overloaded to support both new context-based and legacy string-only calls
	 */
	getSystemPrompt(context: GhostSuggestionContext): string

	/**
	 * Get the user prompt based on context using the new strategy system
	 * @param context The suggestion context
	 * @returns The user prompt
	 */
	getSuggestionPrompt(context: GhostSuggestionContext): string

	/**
	 * Initialize streaming parser for incremental parsing
	 */
	initializeStreamingParser(context: GhostSuggestionContext): void

	/**
	 * Process a chunk of streaming response and return any newly completed suggestions
	 */
	processStreamingChunk(chunk: string): StreamingParseResult

	/**
	 * Reset the streaming parser for a new parsing session
	 */
	resetStreamingParser(): void

	/**
	 * Finish the streaming parser and apply sanitization if needed
	 */
	finishStreamingParser(): StreamingParseResult

	/**
	 * Get the current buffer content from the streaming parser (for debugging)
	 */
	getStreamingBuffer(): string

	/**
	 * Get completed changes from the streaming parser (for debugging)
	 */
	getStreamingCompletedChanges(): any
}
