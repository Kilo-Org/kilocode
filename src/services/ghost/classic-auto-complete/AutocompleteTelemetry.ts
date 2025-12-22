import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import type { AutocompleteContext, CacheMatchType } from "../types"

export type { AutocompleteContext, CacheMatchType }

/**
 * Type of autocomplete being used
 * - "inline": Classic inline code completion in the editor
 * - "chat-textarea": Autocomplete in the chat input textarea
 */
export type AutocompleteType = "inline" | "chat-textarea"

/**
 * Telemetry service for autocomplete events.
 * Can be initialized without parameters and injected into components that need telemetry tracking.
 * Supports different autocomplete types via the `autocompleteType` property.
 */
export class AutocompleteTelemetry {
	private readonly autocompleteType: AutocompleteType

	/**
	 * Create a new AutocompleteTelemetry instance
	 * @param autocompleteType - The type of autocomplete (defaults to "inline" for backward compatibility)
	 */
	constructor(autocompleteType: AutocompleteType = "inline") {
		this.autocompleteType = autocompleteType
	}

	private captureEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void {
		// also log to console:
		if (TelemetryService.hasInstance()) {
			const propsWithType = {
				...properties,
				autocompleteType: this.autocompleteType,
			}
			TelemetryService.instance.captureEvent(event, propsWithType)
			console.log(`Autocomplete Telemetry event: ${event}`, propsWithType)
		}
	}

	/**
	 * Capture when a suggestion is requested, this is whenever our completion provider is invoked by VS Code
	 *
	 * Subsets:
	 *  - captureLlmRequestCompleted
	 *  - captureLlmRequestFailed
	 *  - captureCacheHit
	 *  - (not captured) request is not answered, for instance because we are debouncing (i.e. user is still typing)
	 */
	public captureSuggestionRequested(context: AutocompleteContext): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_SUGGESTION_REQUESTED, {
			languageId: context.languageId,
			modelId: context.modelId,
			provider: context.provider,
		})
	}

	/**
	 * Capture when a suggestion is filtered out by our software
	 *
	 * @param reason - The reason the suggestion was filtered out
	 * @param context - The autocomplete context
	 */
	public captureSuggestionFiltered(
		reason: "empty_response" | "filtered_by_postprocessing",
		context: AutocompleteContext,
	): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_SUGGESTION_FILTERED, {
			reason,
			...context,
		})
	}

	/**
	 * Capture when a suggestion is found in cache/history
	 *
	 * @param matchType - How the suggestion was matched from cache
	 * @param context - The autocomplete context
	 * @param suggestionLength - The length of the suggestion in characters
	 */
	public captureCacheHit(matchType: CacheMatchType, context: AutocompleteContext, suggestionLength: number): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_SUGGESTION_CACHE_HIT, {
			matchType,
			languageId: context.languageId,
			modelId: context.modelId,
			provider: context.provider,
			suggestionLength,
		})
	}

	/**
	 * Capture when a newly requested suggestion is returned to the user (so no cache hit)
	 *
	 * Summed with the cache hits this is the total number of suggestions shown
	 *
	 * @param context - The autocomplete context
	 * @param suggestionLength - The length of the suggestion in characters
	 */
	public captureLlmSuggestionReturned(context: AutocompleteContext, suggestionLength: number): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_LLM_SUGGESTION_RETURNED, {
			...context,
			suggestionLength,
		})
	}

	/**
	 * Capture when an LLM request completes successfully
	 *
	 * @param properties - Request metrics including latency, cost, and token counts
	 * @param context - The autocomplete context
	 */
	public captureLlmRequestCompleted(
		properties: {
			latencyMs: number
			cost?: number
			inputTokens?: number
			outputTokens?: number
		},
		context: AutocompleteContext,
	): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_COMPLETED, {
			...properties,
			...context,
		})
	}

	/**
	 * Capture when an LLM request fails
	 *
	 * @param properties - Error details including latency and error message
	 * @param context - The autocomplete context
	 */
	public captureLlmRequestFailed(
		properties: { latencyMs: number; error: string },
		context: AutocompleteContext,
	): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED, {
			...properties,
			...context,
		})
	}

	/**
	 * Capture when a user accepts a suggestion
	 *
	 * There are two ways to analyze what percentage was accepted:
	 * 1. Sum of this event divided by the sum of the suggestion returned event
	 * 2. Sum of this event divided by the sum of the suggestion returned + cache hit events
	 *
	 * @param suggestionLength - Optional length of the accepted suggestion
	 */
	public captureAcceptSuggestion(suggestionLength?: number): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_ACCEPT_SUGGESTION, {
			...(suggestionLength !== undefined && { suggestionLength }),
		})
	}
}
