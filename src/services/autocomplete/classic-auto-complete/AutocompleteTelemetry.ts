import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import type { AutocompleteContext, CacheMatchType, FillInAtCursorSuggestion } from "../types"

export type { AutocompleteContext, CacheMatchType, FillInAtCursorSuggestion }

/**
 * Generate a unique key for a suggestion based on its content and context.
 * This key is used to track whether the same suggestion is still being displayed.
 */
export function getSuggestionKey(suggestion: FillInAtCursorSuggestion): string {
	return `${suggestion.prefix}|${suggestion.suffix}|${suggestion.text}`
}

/**
 * Minimum time in milliseconds that a suggestion must be visible before
 * it counts as a "unique suggestion shown" for telemetry purposes.
 * This filters out suggestions that flash briefly when the user is typing quickly.
 */
export const MIN_VISIBILITY_DURATION_MS = 300

/**
 * Maximum number of recent suggestion keys for which we've fired unique telemetry.
 * Prevents unbounded growth over long sessions.
 */
const MAX_FIRED_UNIQUE_TELEMETRY_KEYS = 50

/**
 * Type of autocomplete being used
 * - "inline": Classic inline code completion in the editor
 * - "chat-textarea": Autocomplete in the chat input textarea
 */
export type AutocompleteType = "inline" | "chat-textarea"

/**
 * Tracks the currently displayed suggestion for visibility-based telemetry.
 * Used to determine if a suggestion has been visible for MIN_VISIBILITY_DURATION_MS.
 */
interface VisibilityTrackingState {
	/** Unique key identifying the currently displayed suggestion */
	suggestionKey: string
	/** Timer that fires after MIN_VISIBILITY_DURATION_MS to capture telemetry */
	timer: NodeJS.Timeout
	/** The source of the suggestion (llm or cache) */
	source: "llm" | "cache"
	/** Telemetry context for the suggestion */
	telemetryContext: AutocompleteContext
	/** Length of the suggestion text */
	suggestionLength: number
}

/**
 * Telemetry service for autocomplete events.
 * Can be initialized without parameters and injected into components that need telemetry tracking.
 * Supports different autocomplete types via the `autocompleteType` property.
 */
export class AutocompleteTelemetry {
	private readonly autocompleteType: AutocompleteType
	/** Tracks the currently displayed suggestion for visibility-based telemetry */
	private visibilityTracking: VisibilityTrackingState | null = null
	/**
	 * Tracks suggestion keys for which unique telemetry has already been fired.
	 * Uses insertion order to evict the oldest keys when the cap is exceeded.
	 */
	private firedUniqueTelemetryKeys: Map<string, true> = new Map()

	private markSuggestionKeyAsFired(suggestionKey: string): void {
		this.firedUniqueTelemetryKeys.set(suggestionKey, true)

		if (this.firedUniqueTelemetryKeys.size > MAX_FIRED_UNIQUE_TELEMETRY_KEYS) {
			const oldestKey = this.firedUniqueTelemetryKeys.keys().next().value as string | undefined
			if (oldestKey) {
				this.firedUniqueTelemetryKeys.delete(oldestKey)
			}
		}
	}

	/**
	 * Create a new AutocompleteTelemetry instance
	 * @param autocompleteType - The type of autocomplete (defaults to "inline" for backward compatibility)
	 */
	constructor(autocompleteType: AutocompleteType = "inline") {
		this.autocompleteType = autocompleteType
	}

	private captureEvent(event: TelemetryEventName, properties?: Record<string, unknown>): void {
		if (TelemetryService.hasInstance()) {
			const propsWithType = {
				...properties,
				autocompleteType: this.autocompleteType,
			}
			TelemetryService.instance.captureEvent(event, propsWithType)
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

	/**
	 * Capture when a unique suggestion is shown to the user for the first time.
	 *
	 * @param context - The autocomplete context
	 */
	private captureUniqueSuggestionShown(context: AutocompleteContext): void {
		this.captureEvent(TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN, {
			...context,
		})
	}

	/**
	 * Start visibility tracking for a suggestion.
	 * If the suggestion is still being displayed after MIN_VISIBILITY_DURATION_MS,
	 * the unique suggestion telemetry will be fired.
	 *
	 * @param suggestion - The suggestion to track (will be serialized to a key internally)
	 * @param source - Whether the suggestion came from 'llm' or 'cache'
	 * @param telemetryContext - Telemetry context for the suggestion
	 */
	public startVisibilityTracking(
		suggestion: FillInAtCursorSuggestion,
		source: "llm" | "cache",
		telemetryContext: AutocompleteContext,
	): void {
		const suggestionKey = getSuggestionKey(suggestion)
		const suggestionLength = suggestion.text.length

		// If we're already tracking this exact suggestion, do nothing
		if (this.visibilityTracking?.suggestionKey === suggestionKey) {
			return
		}

		// Cancel any existing visibility tracking (different suggestion is now shown)
		this.cancelVisibilityTracking()

		// Don't track if we've already fired telemetry for this suggestion
		if (this.firedUniqueTelemetryKeys.has(suggestionKey)) {
			return
		}

		// Don't track empty suggestions
		if (suggestionLength === 0) {
			return
		}

		const timer = setTimeout(() => {
			// The suggestion has been visible for MIN_VISIBILITY_DURATION_MS
			this.captureUniqueSuggestionShown(telemetryContext)
			this.markSuggestionKeyAsFired(suggestionKey)
			this.visibilityTracking = null
		}, MIN_VISIBILITY_DURATION_MS)

		this.visibilityTracking = {
			suggestionKey,
			timer,
			source,
			telemetryContext,
			suggestionLength,
		}
	}

	/**
	 * Cancel any pending visibility tracking.
	 * Called when a different suggestion is shown or no suggestion is shown.
	 */
	public cancelVisibilityTracking(): void {
		if (this.visibilityTracking) {
			clearTimeout(this.visibilityTracking.timer)
			this.visibilityTracking = null
		}
	}

	/**
	 * Dispose of the telemetry service, cleaning up any pending timers.
	 */
	public dispose(): void {
		this.cancelVisibilityTracking()
	}
}
