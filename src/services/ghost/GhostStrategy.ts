import { GhostSuggestionContext } from "./types"
import { StreamingParseResult } from "./GhostStreamingParser"
import { PromptStrategy } from "./types/PromptStrategy"

export class GhostStrategy {
	private currentStrategy: PromptStrategy | null = null
	private debug: boolean

	constructor(_options?: { debug: boolean }) {
		this.debug = true // Always enable debug for now
	}

	/**
	 * Set the current enhanced prompt strategy
	 */
	public setStrategy(strategy: PromptStrategy): void {
		this.currentStrategy = strategy
	}

	/**
	 * Get the system prompt using the current strategy
	 */
	async getSystemPrompt(_context: GhostSuggestionContext): Promise<string> {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		const systemPrompt = this.currentStrategy.getSystemInstructions()

		if (this.debug && !process.env.GHOST_QUIET_MODE) {
			console.log(`[GhostStrategy] Using strategy: ${this.currentStrategy.name}`)
		}

		return systemPrompt
	}

	/**
	 * Get the user prompt using the current strategy
	 */
	async getSuggestionPrompt(context: GhostSuggestionContext): Promise<string> {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		const userPrompt = await this.currentStrategy.getUserPrompt(context)

		if (this.debug && !process.env.GHOST_QUIET_MODE) {
			console.log(`[GhostStrategy] Generated prompt with strategy: ${this.currentStrategy.name}`)
		}

		return userPrompt
	}

	/**
	 * Get complete strategy information
	 */
	async getStrategyInfo(context: GhostSuggestionContext): Promise<{
		systemPrompt: string
		userPrompt: string
		strategy: PromptStrategy
	}> {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		// CRITICAL: Initialize the strategy before getting prompts
		// This ensures Mercury strategy has its editableRegion calculated
		this.currentStrategy.initializeProcessing(context)

		const systemPrompt = await this.getSystemPrompt(context)
		const userPrompt = await this.getSuggestionPrompt(context)

		return {
			systemPrompt,
			userPrompt,
			strategy: this.currentStrategy,
		}
	}

	/**
	 * Initialize streaming parser using current strategy
	 */
	public initializeStreamingParser(context: GhostSuggestionContext): void {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		this.currentStrategy.initializeProcessing(context)
	}

	/**
	 * Process a chunk of streaming response using current strategy
	 */
	public processStreamingChunk(chunk: string): StreamingParseResult {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		return this.currentStrategy.processResponseChunk(chunk)
	}

	/**
	 * Reset the current strategy parser
	 */
	public resetStreamingParser(): void {
		if (this.currentStrategy) {
			this.currentStrategy.reset()
		}
	}

	/**
	 * Finish streaming using current strategy
	 */
	public finishStreamingParser(): StreamingParseResult {
		if (!this.currentStrategy) {
			throw new Error("No prompt strategy set. Call setStrategy() first.")
		}

		return this.currentStrategy.finishProcessing()
	}

	/**
	 * Get current strategy name
	 */
	public getCurrentStrategyName(): string {
		return this.currentStrategy?.name ?? "None"
	}

	/**
	 * Get the current buffer content (for debugging compatibility)
	 */
	public getStreamingBuffer(): string {
		// For compatibility with tests - strategies handle their own state
		return ""
	}

	/**
	 * Get completed changes (for debugging compatibility)
	 */
	public getStreamingCompletedChanges(): unknown[] {
		// For compatibility with tests - strategies handle their own state
		return []
	}
}
