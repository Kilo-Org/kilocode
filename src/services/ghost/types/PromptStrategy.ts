import { GhostSuggestionContext } from "../types"

/**
 * Interface for prompt strategies that generate context-aware prompts
 */
export interface PromptStrategy {
	name: string

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
