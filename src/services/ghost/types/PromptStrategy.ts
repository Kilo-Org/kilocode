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
	 * Generates both system and user prompts
	 * @param context The suggestion context
	 * @returns Object containing both prompts
	 */
	getPrompts(context: GhostSuggestionContext): {
		systemPrompt: string
		userPrompt: string
	}
}
