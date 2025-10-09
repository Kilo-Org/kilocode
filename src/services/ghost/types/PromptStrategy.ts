import { GhostSuggestionContext } from "../types"

/**
 * Enum representing different use case types for prompt strategies
 */
export enum UseCaseType {
	USER_REQUEST = "USER_REQUEST",
	ERROR_FIX = "ERROR_FIX",
	NEW_LINE = "NEW_LINE",
	INLINE_COMPLETION = "INLINE_COMPLETION",
	COMMENT_DRIVEN = "COMMENT_DRIVEN",
	SELECTION_REFACTOR = "SELECTION_REFACTOR",
	AUTO_TRIGGER = "AUTO_TRIGGER",
	FIM_CODESTRAL = "FIM_CODESTRAL",
}

/**
 * Interface for prompt strategies that generate context-aware prompts
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
	 * @param context The suggestion context to evaluate
	 * @returns true if this strategy can handle the context
	 */
	canHandle(context: GhostSuggestionContext): boolean

	/**
	 * Generates system instructions for the AI model
	 * @param customInstructions Optional custom instructions to append
	 * @returns The complete system prompt
	 */
	getSystemInstructions(customInstructions?: string): string

	/**
	 * Generates the user prompt with context
	 * @param context The suggestion context
	 * @returns The user prompt
	 */
	getUserPrompt(context: GhostSuggestionContext): string
}
