import * as vscode from "vscode"
import { TelemetryEventName } from "../../telemetry/types"
import type { AutocompleteContext, CacheMatchType, FillInAtCursorSuggestion } from "../types"
import { getSuggestionKey as _getSuggestionKey, insertWithLRUEviction } from "./telemetry-utils"

export type { AutocompleteContext, CacheMatchType, FillInAtCursorSuggestion }

export function getSuggestionKey(suggestion: FillInAtCursorSuggestion): string {
  return _getSuggestionKey(suggestion)
}

/** The autocomplete events of the extension's telemetry catalog. */
export const AutocompleteTelemetryEvent = {
  AUTOCOMPLETE_SUGGESTION_REQUESTED: TelemetryEventName.AUTOCOMPLETE_SUGGESTION_REQUESTED,
  AUTOCOMPLETE_LLM_REQUEST_COMPLETED: TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_COMPLETED,
  AUTOCOMPLETE_LLM_REQUEST_FAILED: TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED,
  AUTOCOMPLETE_LLM_SUGGESTION_RETURNED: TelemetryEventName.AUTOCOMPLETE_LLM_SUGGESTION_RETURNED,
  AUTOCOMPLETE_SUGGESTION_CACHE_HIT: TelemetryEventName.AUTOCOMPLETE_SUGGESTION_CACHE_HIT,
  AUTOCOMPLETE_ACCEPT_SUGGESTION: TelemetryEventName.AUTOCOMPLETE_ACCEPT_SUGGESTION,
  AUTOCOMPLETE_SUGGESTION_FILTERED: TelemetryEventName.AUTOCOMPLETE_SUGGESTION_FILTERED,
  AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN: TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN,
  INLINE_ASSIST_AUTO_TASK: TelemetryEventName.INLINE_ASSIST_AUTO_TASK,
  GHOST_SERVICE_DISABLED: TelemetryEventName.GHOST_SERVICE_DISABLED,
} as const

export type AutocompleteTelemetryEventName = (typeof AutocompleteTelemetryEvent)[keyof typeof AutocompleteTelemetryEvent]

export type AutocompleteTelemetryCapture = (event: string, properties: Record<string, unknown>) => void

let transport: AutocompleteTelemetryCapture | undefined

/**
 * Register the telemetry transport that forwards autocomplete events. The extension registers the telemetry proxy at
 * activation (`registerTelemetry`); without a transport the default capture drops events after the consent check.
 */
export function setAutocompleteTelemetrySink(fn: AutocompleteTelemetryCapture | undefined): void {
  transport = fn
}

/**
 * Default capture sink. It honours the user's telemetry consent and forwards to
 * the registered transport.
 */
function defaultCapture(event: string, properties: Record<string, unknown>): void {
  if (!vscode.env.isTelemetryEnabled) return
  transport?.(event, properties)
}

/**
 * Emit an autocomplete telemetry event through the consent-gated sink. Use this
 * for events that are not tied to an AutocompleteTelemetry instance, such as the
 * standalone service and inline-assist events.
 */
export function captureAutocompleteTelemetry(
  event: AutocompleteTelemetryEventName,
  properties?: Record<string, unknown>,
): void {
  defaultCapture(event, properties ?? {})
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
 * Supports different autocomplete types via the first constructor argument.
 */
export class AutocompleteTelemetry {
  private readonly autocompleteType: AutocompleteType
  private readonly capture: AutocompleteTelemetryCapture
  /** Tracks the currently displayed suggestion for visibility-based telemetry */
  private visibilityTracking: VisibilityTrackingState | null = null
  /**
   * Tracks suggestion keys for which unique telemetry has already been fired.
   * Uses insertion order to evict the oldest keys when the cap is exceeded.
   */
  private firedUniqueTelemetryKeys: Map<string, true> = new Map()

  private markSuggestionKeyAsFired(suggestionKey: string): void {
    insertWithLRUEviction(this.firedUniqueTelemetryKeys, suggestionKey, MAX_FIRED_UNIQUE_TELEMETRY_KEYS)
  }

  /**
   * Create a new AutocompleteTelemetry instance
   * @param autocompleteType - The type of autocomplete (defaults to "inline")
   * @param capture - The sink that receives captured events (defaults to the consent-gated transport forwarder)
   */
  constructor(autocompleteType: AutocompleteType = "inline", capture: AutocompleteTelemetryCapture = defaultCapture) {
    this.autocompleteType = autocompleteType
    this.capture = capture
  }

  private captureEvent(event: AutocompleteTelemetryEventName, properties?: Record<string, unknown>): void {
    const props = {
      ...properties,
      autocompleteType: this.autocompleteType,
    }
    this.capture(event, props)
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
    // Temporarily disabled for cost reduction: this event represents >50% of our telemetry
    // event volume and we don't use it for reporting (we only care about suggestions
    // accepted).
    void context
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
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_SUGGESTION_FILTERED, {
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
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_SUGGESTION_CACHE_HIT, {
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
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_LLM_SUGGESTION_RETURNED, {
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
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_LLM_REQUEST_COMPLETED, {
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
  public captureLlmRequestFailed(properties: { latencyMs: number; error: string }, context: AutocompleteContext): void {
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_LLM_REQUEST_FAILED, {
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
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_ACCEPT_SUGGESTION, {
      ...(suggestionLength !== undefined && { suggestionLength }),
    })
  }

  /**
   * Capture when a unique suggestion is shown to the user for the first time.
   *
   * @param context - The autocomplete context
   */
  private captureUniqueSuggestionShown(context: AutocompleteContext): void {
    this.captureEvent(AutocompleteTelemetryEvent.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN, {
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
