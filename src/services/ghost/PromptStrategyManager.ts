import { GhostSuggestionContext } from "./types"
import { PromptGenerator } from "./types/PromptGenerator"
import { ContextAnalyzer } from "./ContextAnalyzer"
import { UserRequestPromptGenerator } from "./strategies/UserRequestPromptGenerator"

/**
 * Manages prompt strategies and selects the appropriate one based on context
 */
export class PromptStrategyManager {
	private contextAnalyzer: ContextAnalyzer
	private debug: boolean

	constructor(options?: { debug: boolean }) {
		this.debug = options?.debug ?? false
		this.contextAnalyzer = new ContextAnalyzer()
	}

	/**
	 * Selects the most appropriate strategy for the given context
	 * @param context The suggestion context
	 * @returns The selected strategy
	 */
	selectStrategy(context: GhostSuggestionContext): PromptGenerator {
		// Analyze context to understand the situation
		const analysis = this.contextAnalyzer.analyze(context)

		if (this.debug) {
			console.log("[PromptStrategyManager] Context analysis:", {
				useCase: analysis.useCase,
				hasUserInput: analysis.hasUserInput,
				hasErrors: analysis.hasErrors,
				hasSelection: analysis.hasSelection,
				isNewLine: analysis.isNewLine,
				isInComment: analysis.isInComment,
				isInlineEdit: analysis.isInlineEdit,
			})
		}
		return new UserRequestPromptGenerator()
	}

	/**
	 * Builds complete prompts using the selected strategy
	 * @param context The suggestion context
	 * @returns Object containing system and user prompts
	 */
	buildPrompt(context: GhostSuggestionContext): {
		systemPrompt: string
		userPrompt: string
		strategy: PromptGenerator
	} {
		const strategy = this.selectStrategy(context)

		const systemPrompt = strategy.getSystemInstructions()
		const userPrompt = strategy.getUserPrompt(context)

		if (this.debug) {
			console.log("[PromptStrategyManager] Prompt built:", {
				strategy: strategy.name,
				systemPromptLength: systemPrompt.length,
				userPromptLength: userPrompt.length,
				totalTokensEstimate: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
			})
		}

		return {
			systemPrompt,
			userPrompt,
			strategy,
		}
	}
}
