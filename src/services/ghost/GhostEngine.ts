import crypto from "crypto"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionContext } from "./types"
import { GhostContext } from "./GhostContext"
import { GhostModel } from "./GhostModel"
import { GhostStrategy } from "./GhostStrategy"
import { GhostSuggestionCache } from "./GhostSuggestionCache"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName, GhostServiceSettings } from "@roo-code/types"
import { createGhostSuggestionOutcome, GhostSuggestionOutcome, PromptMetadata } from "./types/GhostSuggestionOutcome"
import { GhostEngineContext } from "./types/platform-independent"
import { IGhostApplicator } from "./applicators/IGhostApplicator"
import { GhostProfile } from "./profiles/GhostProfile"
import { GhostCancellationError } from "./errors/GhostErrors"

/**
 * Result returned by the GhostEngine containing all generated suggestions and metadata
 */
export interface GhostEngineResult {
	suggestions: GhostSuggestionsState
	executionTime: number
	rawResponse: string
	profile: GhostProfile | null
	metadata: {
		tokensUsed?: number
		cost?: number
		inputTokens?: number
		outputTokens?: number
		cacheReadTokens?: number
		cacheWriteTokens?: number
	}
	ghostSuggestionOutcome?: GhostSuggestionOutcome
	promptMetadata?: PromptMetadata
}

/**
 * Core Ghost autocomplete engine that contains all business logic
 * Used by both GhostProvider (VSCode integration) and BenchmarkRunner (testing)
 */
export class GhostEngine {
	private model: GhostModel
	private strategy: GhostStrategy
	private ghostContext: GhostContext
	private suggestionCache: GhostSuggestionCache
	private taskId: string | null = null
	private cancellationToken: AbortController | null = null

	constructor(providerSettingsManager: ProviderSettingsManager, documentStore: GhostDocumentStore) {
		this.model = new GhostModel(providerSettingsManager)
		this.strategy = new GhostStrategy({ debug: true })
		this.ghostContext = new GhostContext(documentStore)
		this.suggestionCache = new GhostSuggestionCache()
	}

	/**
	 * Set task ID for telemetry tracking
	 */
	public setTaskId(taskId: string): void {
		this.taskId = taskId
	}

	/**
	 * Cancel the current request
	 */
	public cancelRequest(): void {
		if (this.cancellationToken) {
			this.cancellationToken.abort()
		}
	}

	/**
	 * Check if the current operation is cancelled
	 */
	private checkCancellation(): void {
		if (this.cancellationToken?.signal.aborted) {
			throw new GhostCancellationError("Operation was cancelled")
		}
	}

	/**
	 * Load the model with settings
	 */
	public async load(settings: GhostServiceSettings | null): Promise<void> {
		await this.model.reload(settings || {})
	}

	/**
	 * Check if the model is loaded
	 */
	public get loaded(): boolean {
		return this.model.loaded
	}

	/**
	 * Switch to a different Ghost profile (for benchmarking)
	 */
	public async switchProfile(profileId: string): Promise<boolean> {
		return await this.model.switchProfile(profileId)
	}

	/**
	 * Get the model's profile manager (for benchmarking)
	 */
	public getProfileManager() {
		return this.model.getProfileManager()
	}

	/**
	 * Execute completion and apply suggestions using provided applicator
	 *
	 * @param engineContext Platform-independent context
	 * @param applicator REQUIRED applicator for applying suggestions (no fallback)
	 * @param applyMode How to apply: 'all', 'selected', or 'none'
	 *
	 * CRITICAL: applicator is REQUIRED - no optional parameter, no default.
	 * Every caller must explicitly provide the appropriate applicator:
	 * - VSCodeGhostApplicator for production (GhostProvider)
	 * - StringGhostApplicator for tests/benchmarks
	 */
	async executeCompletion(
		engineContext: GhostEngineContext,
		applicator: IGhostApplicator, // REQUIRED - no optional, no default
		applyMode: "all" | "selected" | "none" = "none",
	): Promise<GhostEngineResult> {
		const startTime = Date.now()
		this.cancellationToken = new AbortController()

		// Convert platform-independent context to legacy GhostSuggestionContext
		const legacyContext: GhostSuggestionContext = {
			document: engineContext.document as any, // VSCodeDocumentAdapter implements compatible interface
			editor: undefined, // Not available in platform-independent context
			range: engineContext.range as any, // GhostRange is compatible with Range interface
			userInput: engineContext.userInput,
		}

		// Generate full context
		const fullContext = await this.ghostContext.generate(legacyContext)

		this.checkCancellation()

		// Check if we have cached suggestions for this context
		const cachedSuggestions = this.suggestionCache.get(engineContext.document, engineContext.position)

		if (cachedSuggestions) {
			// Apply cached suggestions if requested
			if (applyMode !== "none") {
				await this.applySuggestions(cachedSuggestions, engineContext.document.uri, applicator, applyMode)
			}

			const executionTime = Date.now() - startTime
			return {
				suggestions: cachedSuggestions,
				executionTime,
				rawResponse: "[CACHED]",
				profile: this.model.getCurrentProfile(),
				metadata: {},
			}
		}

		if (!this.model.loaded) {
			throw new Error("Model not loaded")
		}

		// Get current Ghost profile and its strategy
		const currentProfile = this.model.getCurrentProfile()
		if (!currentProfile || !currentProfile.isInitialized()) {
			throw new Error("No Ghost profile loaded")
		}

		const strategy = currentProfile.getPromptStrategy()

		// Set the strategy on GhostStrategy
		this.strategy.setStrategy(strategy)

		// Get strategy info using the strategy
		const strategyInfo = await this.strategy.getStrategyInfo(fullContext)

		if (!process.env.GHOST_QUIET_MODE) {
			console.log("📝 Ghost user prompt:", strategyInfo.userPrompt)
		}

		// Handle all suggestions using unified streaming approach
		const result = await this.handleStreamingSuggestions(
			fullContext,
			engineContext,
			strategyInfo,
			strategy,
			startTime,
		)

		// Store successful suggestions in cache
		if (result.suggestions.hasSuggestions()) {
			this.suggestionCache.store(engineContext.document, engineContext.position, result.suggestions)
		}

		// Apply suggestions if requested
		if (applyMode !== "none" && result.suggestions.hasSuggestions()) {
			await this.applySuggestions(result.suggestions, engineContext.document.uri, applicator, applyMode)
		}

		return result
	}

	/**
	 * Apply suggestions using provided applicator
	 * This is the complete orchestration point for application
	 *
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI (string)
	 * @param applicator The platform-specific applicator
	 * @param mode Whether to apply all or selected suggestions
	 */
	private async applySuggestions(
		suggestions: GhostSuggestionsState,
		fileUri: string,
		applicator: IGhostApplicator,
		mode: "all" | "selected",
	): Promise<void> {
		try {
			if (mode === "all") {
				await applicator.applyAll(suggestions, fileUri)
			} else {
				await applicator.applySelected(suggestions, fileUri)
			}
		} catch (error) {
			console.error("Error applying suggestions:", error)
			throw error
		}
	}

	/**
	 * Public method for applying suggestions after generation
	 * Allows GhostProvider to trigger application separately
	 *
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI (string)
	 * @param applicator REQUIRED applicator (no fallback)
	 * @param mode Whether to apply all or selected suggestions
	 */
	public async apply(
		suggestions: GhostSuggestionsState,
		fileUri: string,
		applicator: IGhostApplicator, // REQUIRED
		mode: "all" | "selected" = "selected",
	): Promise<void> {
		await this.applySuggestions(suggestions, fileUri, applicator, mode)
	}

	/**
	 * Handle all suggestions using streaming interface (both true streaming and accumulated)
	 */
	private async handleStreamingSuggestions(
		context: GhostSuggestionContext,
		engineContext: GhostEngineContext,
		strategyInfo: { systemPrompt: string; userPrompt: string; strategy: any },
		strategy: any,
		startTime: number,
	): Promise<GhostEngineResult> {
		// Ghost Support: Inject unique token for Mercury models before sending
		if (strategy.shouldInjectUniqueToken && strategy.shouldInjectUniqueToken(context)) {
			const uniqueToken = strategy.getUniqueToken()
			if (uniqueToken) {
				// Inject token into user prompt (Continue's approach)
				strategyInfo.userPrompt += uniqueToken
			}
		}

		// Initialize the streaming parser
		this.strategy.initializeStreamingParser(context)

		let hasShownFirstSuggestion = false
		let response = ""
		let suggestions = new GhostSuggestionsState()

		// Create unified callback that handles both streaming and non-streaming
		const onChunk = (chunk: any) => {
			try {
				this.checkCancellation()
			} catch (_error) {
				return // Stop processing if cancelled
			}

			if (chunk.type === "text") {
				response += chunk.text

				// Process streaming chunks (all strategies support streaming interface)
				const parseResult = this.strategy.processStreamingChunk(chunk.text)

				if (parseResult.hasNewSuggestions) {
					// Update our suggestions with the new parsed results
					suggestions = parseResult.suggestions
					hasShownFirstSuggestion = true
				}
			}
		}

		let usageInfo: {
			cost?: number
			inputTokens?: number
			outputTokens?: number
			cacheReadTokens?: number
			cacheWriteTokens?: number
			modelProvider?: string
		} = {}

		try {
			// Start streaming generation
			usageInfo = await this.model.generateResponse(strategyInfo.systemPrompt, strategyInfo.userPrompt, onChunk)

			// Log complete response for debugging
			if (!process.env.GHOST_QUIET_MODE) {
				console.log("📩 Ghost response received:", response)
			}

			// Send telemetry if taskId is available
			if (this.taskId) {
				TelemetryService.instance.captureEvent(TelemetryEventName.LLM_COMPLETION, {
					taskId: this.taskId,
					inputTokens: usageInfo.inputTokens,
					outputTokens: usageInfo.outputTokens,
					cacheWriteTokens: usageInfo.cacheWriteTokens,
					cacheReadTokens: usageInfo.cacheReadTokens,
					cost: usageInfo.cost,
					service: "INLINE_ASSIST",
				})
			}

			this.checkCancellation()

			// Finish the streaming parser to apply sanitization if needed
			const finalParseResult = this.strategy.finishStreamingParser()
			if (finalParseResult.hasNewSuggestions) {
				suggestions = finalParseResult.suggestions
				hasShownFirstSuggestion = true
			}

			// Generate GhostSuggestionOutcome and PromptMetadata for Mercury models
			let ghostSuggestionOutcome: GhostSuggestionOutcome | undefined
			let promptMetadata: PromptMetadata | undefined

			if (hasShownFirstSuggestion && strategy.buildPromptMetadata) {
				try {
					ghostSuggestionOutcome =
						(await this.generateGhostSuggestionOutcome(
							context,
							engineContext,
							strategyInfo,
							strategy,
							response,
							usageInfo,
							startTime,
						)) || undefined

					if (ghostSuggestionOutcome) {
						// Store outcome metadata in suggestions
						suggestions.setGhostSuggestionMetadata(ghostSuggestionOutcome, promptMetadata)
					}
				} catch (error) {
					console.warn("Failed to generate GhostSuggestionOutcome:", error)
				}
			}

			const executionTime = Date.now() - startTime

			return {
				suggestions,
				executionTime,
				rawResponse: response,
				profile: this.model.getCurrentProfile(),
				metadata: {
					tokensUsed: usageInfo.outputTokens,
					cost: usageInfo.cost,
					inputTokens: usageInfo.inputTokens,
					outputTokens: usageInfo.outputTokens,
					cacheReadTokens: usageInfo.cacheReadTokens,
					cacheWriteTokens: usageInfo.cacheWriteTokens,
				},
				ghostSuggestionOutcome,
				promptMetadata,
			}
		} catch (error) {
			console.error("Error in streaming generation:", error)
			throw error
		}
	}

	/**
	 * Generate GhostSuggestionOutcome for Mercury models (extracted from GhostProvider)
	 */
	private async generateGhostSuggestionOutcome(
		context: GhostSuggestionContext,
		engineContext: GhostEngineContext,
		strategyInfo: { systemPrompt: string; userPrompt: string; strategy: any },
		strategy: any,
		response: string,
		usageInfo: {
			cost?: number
			inputTokens?: number
			outputTokens?: number
			cacheReadTokens?: number
			cacheWriteTokens?: number
			modelProvider?: string
		},
		startTime: number,
	): Promise<GhostSuggestionOutcome | null> {
		try {
			// Build prompt metadata using strategy
			const promptMetadata = await strategy.buildPromptMetadata(context, strategyInfo)
			if (!promptMetadata) {
				console.warn("Failed to build prompt metadata")
				return null
			}

			// Extract needed values for the outcome
			const profile = this.model.getCurrentProfile()
			const currentPosition = engineContext.position

			// Create the outcome using the correct parameters
			const outcome = createGhostSuggestionOutcome({
				completionId: crypto.randomUUID(),
				fileUri: engineContext.document.uri,
				completion: response,
				modelProvider: usageInfo.modelProvider || profile?.getSummary().name || "unknown",
				modelName: profile?.getSummary().modelName || "unknown",
				elapsed: Date.now() - startTime,
				cursorPosition: {
					line: currentPosition.line,
					character: currentPosition.character,
				},
				editableRegionStartLine: 0, // Will be calculated by strategy if needed
				editableRegionEndLine: engineContext.document.lineCount,
				diffLines: [], // Will be populated by strategy if needed
				prompt: strategyInfo.userPrompt,
				originalEditableRange: engineContext.document.getText(),
				userEdits: promptMetadata?.userEdits || "",
				userExcerpts: promptMetadata?.userExcerpts || "",
			})

			return outcome
		} catch (error) {
			console.error("Error generating GhostSuggestionOutcome:", error)
			return null
		}
	}

	/**
	 * Get cache metrics
	 */
	public getCacheMetrics() {
		return this.suggestionCache.getMetrics()
	}

	/**
	 * Clear cache
	 */
	public clearCache(): void {
		this.suggestionCache.clear()
	}
}
