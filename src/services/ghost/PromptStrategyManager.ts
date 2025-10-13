import { GhostSuggestionContext } from "./types"
import { PromptStrategy } from "./types/PromptStrategy"

// Import all strategies
import { UserRequestStrategy } from "./strategies/UserRequestStrategy"
import { CommentDrivenStrategy } from "./strategies/CommentDrivenStrategy"
import { AutoTriggerStrategy } from "./strategies/AutoTriggerStrategy"

/**
 * Manages prompt strategies and selects the appropriate one based on context
 */
export class PromptStrategyManager {
	private strategies: PromptStrategy[]
	private autoTriggerStrategy: AutoTriggerStrategy
	private debug: boolean
	private overrideStrategy?: string

	constructor(options?: { debug?: boolean; overrideStrategy?: string }) {
		this.debug = options?.debug ?? false
		this.overrideStrategy = options?.overrideStrategy

		// Register all strategies in priority order
		this.strategies = [new UserRequestStrategy(), new CommentDrivenStrategy()]
		this.autoTriggerStrategy = new AutoTriggerStrategy()
	}

	/**
	 * Selects the most appropriate strategy for the given context
	 * @param context The suggestion context
	 * @returns The selected strategy
	 */
	selectStrategy(context: GhostSuggestionContext): PromptStrategy {
		// If an override strategy is specified, use that
		if (this.overrideStrategy) {
			const overrideStrat = this.strategies.find((s) => s.name === this.overrideStrategy)
			if (overrideStrat) {
				if (this.debug) {
					console.log(`[PromptStrategyManager] Using override strategy: ${overrideStrat.name}`)
				}
				return overrideStrat
			}
		}

		const strategy = this.strategies.find((s) => s.canHandle(context)) ?? this.autoTriggerStrategy

		if (this.debug) {
			console.log(`[PromptStrategyManager] Selected strategy: ${strategy.name}`)
		}

		return strategy
	}

	getAvailableStrategies(): string[] {
		return [...this.strategies.map((s) => s.name), this.autoTriggerStrategy.name]
	}

	/**
	 * Builds complete prompts using the selected strategy
	 * @param context The suggestion context
	 * @returns Object containing system and user prompts
	 */
	buildPrompt(context: GhostSuggestionContext): {
		systemPrompt: string
		userPrompt: string
		strategy: PromptStrategy
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
