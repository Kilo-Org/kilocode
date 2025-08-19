import { GhostSuggestionContext } from "./types"
import { GhostStreamingParser, StreamingParseResult } from "./GhostStreamingParser"
import { PromptStrategyManager } from "./PromptStrategyManager"

export class GhostStrategy {
	private streamingParser: GhostStreamingParser
	private strategyManager: PromptStrategyManager
	private debug: boolean

	constructor(debug: boolean = false) {
		this.streamingParser = new GhostStreamingParser()
		this.strategyManager = new PromptStrategyManager(debug)
		this.debug = debug
	}

	/**
	 * Get the system prompt based on context using the new strategy system
	 * Overloaded to support both new context-based and legacy string-only calls
	 */
	getSystemPrompt(context: GhostSuggestionContext): string {
		const { systemPrompt, strategy } = this.strategyManager.buildPrompt(context)
		if (this.debug) {
			console.log(`[GhostStrategy] Using strategy: ${strategy.name}`)
		}
		return systemPrompt
	}

	/**
	 * Get the user prompt based on context using the new strategy system
	 * @param context The suggestion context
	 * @returns The user prompt
	 */
	getSuggestionPrompt(context: GhostSuggestionContext): string {
		const { userPrompt, strategy } = this.strategyManager.buildPrompt(context)

		if (this.debug) {
			console.log(`[GhostStrategy] Generated prompt with strategy: ${strategy.name}`)
		}

		return userPrompt
	}

	/**
	 * Initialize streaming parser for incremental parsing
	 */
	public initializeStreamingParser(context: GhostSuggestionContext): void {
		this.streamingParser.initialize(context)
	}

	/**
	 * Process a chunk of streaming response and return any newly completed suggestions
	 */
	public processStreamingChunk(chunk: string): StreamingParseResult {
		return this.streamingParser.processChunk(chunk)
	}

	/**
	 * Reset the streaming parser for a new parsing session
	 */
	public resetStreamingParser(): void {
		this.streamingParser.reset()
	}

	/**
	 * Get the current buffer content from the streaming parser (for debugging)
	 */
	public getStreamingBuffer(): string {
		return this.streamingParser.getBuffer()
	}

	/**
	 * Get completed changes from the streaming parser (for debugging)
	 */
	public getStreamingCompletedChanges() {
		return this.streamingParser.getCompletedChanges()
	}
}
