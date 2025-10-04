import { GhostSuggestionContext } from "../types"
import { StreamingParseResult } from "../GhostStreamingParser"

/**
 * Enum representing different use case types for prompt strategies
 */
export enum UseCaseType {
	USER_REQUEST = "USER_REQUEST",
	MERCURY_CODER = "MERCURY_CODER",
	INLINE_COMPLETION = "INLINE_COMPLETION",
	AUTO_TRIGGER = "AUTO_TRIGGER",
}

/**
 * Prompt Strategy interface that combines prompt generation with response parsing.
 * This eliminates the need for separate parsers and format detection logic.
 */
export interface PromptStrategy {
	/**
	 * Human-readable name of the strategy
	 */
	name: string

	/**
	 * The use case type this strategy handles
	 */
	type: UseCaseType

	/**
	 * Determines if this strategy can handle the given context
	 */
	canHandle(context: GhostSuggestionContext): boolean

	/**
	 * Filters the context to only include relevant fields for this strategy
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext>

	/**
	 * Generates system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string

	/**
	 * Generates the user prompt with context
	 */
	getUserPrompt(context: GhostSuggestionContext): Promise<string>

	/**
	 * Initialize response processing - all strategies use this interface
	 */
	initializeProcessing(context: GhostSuggestionContext): void

	/**
	 * Process a response chunk - all strategies implement this
	 * For non-streaming strategies, they emit complete response as single chunk
	 */
	processResponseChunk(chunk: string): StreamingParseResult

	/**
	 * Finish response processing and return final results
	 */
	finishProcessing(): StreamingParseResult

	/**
	 * Reset parser state for a new parsing session
	 */
	reset(): void
}

/**
 * Configuration for creating prompt strategies
 */
export interface PromptStrategyConfig {
	/**
	 * Strategy name
	 */
	name: string

	/**
	 * Strategy type
	 */
	type: UseCaseType

	/**
	 * Custom system instructions
	 */
	customInstructions?: string
}
