import { GhostSuggestionContext } from "../types"

/**
 * Enum representing different use case types for prompt strategies
 */
export enum UseCaseType {
	USER_REQUEST = "USER_REQUEST",
	AUTO_TRIGGER = "AUTO_TRIGGER",
}

/**
 * Interface for prompt strategies that generate context-aware prompts
 */
export interface PromptGenerator {
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
	 * Filters the context to only include relevant fields for this strategy
	 * @param context The full suggestion context
	 * @returns Partial context with only relevant fields
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext>

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

/**
 * Result of analyzing a suggestion context
 */
export interface ContextAnalysis {
	/**
	 * The primary use case detected
	 */
	useCase: UseCaseType

	/**
	 * Whether the user provided explicit input
	 */
	hasUserInput: boolean

	/**
	 * Whether there are compilation errors
	 */
	hasErrors: boolean

	/**
	 * Whether there are warnings
	 */
	hasWarnings: boolean

	/**
	 * Whether text is selected
	 */
	hasSelection: boolean

	/**
	 * Whether the cursor is in a comment
	 */
	isInComment: boolean

	/**
	 * Whether the cursor is on a new/empty line
	 */
	isNewLine: boolean

	/**
	 * Whether the cursor is in the middle of a line
	 */
	isInlineEdit: boolean

	/**
	 * The text of the current line
	 */
	cursorLine: string

	/**
	 * The cursor's character position
	 */
	cursorPosition: number

	/**
	 * The AST node type at the cursor position
	 */
	astNodeType?: string
}
