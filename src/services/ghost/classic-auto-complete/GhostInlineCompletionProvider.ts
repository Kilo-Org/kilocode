import * as vscode from "vscode"
import {
	extractPrefixSuffix,
	GhostSuggestionContext,
	contextToAutocompleteInput,
	GhostContextProvider,
	FillInAtCursorSuggestion,
	GhostPrompt,
	MatchingSuggestionResult,
	CostTrackingCallback,
	LLMRetrievalResult,
	PendingRequest,
	AutocompleteContext,
	LastSuggestionInfo,
} from "../types"
import { HoleFiller } from "./HoleFiller"
import { FimPromptBuilder } from "./FillInTheMiddle"
import { GhostModel } from "../GhostModel"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { RecentlyVisitedRangesService } from "../../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService"
import { RecentlyEditedTracker } from "../../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited"
import type { GhostServiceSettings } from "@roo-code/types"
import { postprocessGhostSuggestion } from "./uselessSuggestionFilter"
import { shouldSkipAutocomplete } from "./contextualSkip"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { AutocompleteTelemetry } from "./AutocompleteTelemetry"

const MAX_SUGGESTIONS_HISTORY = 20

/**
 * Minimum debounce delay in milliseconds.
 * The adaptive debounce delay will never go below this value, even when
 * average latencies are very fast.
 */
const MIN_DEBOUNCE_DELAY_MS = 150

/**
 * Initial debounce delay in milliseconds.
 * This value is used as the starting debounce delay before enough latency samples
 * are collected. Once LATENCY_SAMPLE_SIZE samples are collected, the debounce delay
 * is dynamically adjusted to the average of recent request latencies.
 */
const INITIAL_DEBOUNCE_DELAY_MS = 300

/**
 * Maximum debounce delay in milliseconds.
 * This caps the adaptive debounce delay to prevent excessive waiting times
 * even when latencies are high.
 */
const MAX_DEBOUNCE_DELAY_MS = 1000

/**
 * Number of latency samples to collect before using adaptive debounce delay.
 * Once this many samples are collected, the debounce delay becomes the average
 * of the stored latencies, updated after each request.
 */
const LATENCY_SAMPLE_SIZE = 10

export type { CostTrackingCallback, GhostPrompt, MatchingSuggestionResult, LLMRetrievalResult }

/**
 * Result from findMatchingSuggestion including the original suggestion for telemetry tracking
 */
export interface MatchingSuggestionWithFillIn extends MatchingSuggestionResult {
	/** The original FillInAtCursorSuggestion for telemetry tracking */
	fillInAtCursor: FillInAtCursorSuggestion
}

/**
 * Find a matching suggestion from the history based on current prefix and suffix.
 *
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion with match type and the original FillInAtCursorSuggestion, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): MatchingSuggestionWithFillIn | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// First, try exact prefix/suffix match
		if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
			return {
				text: fillInAtCursor.text,
				matchType: "exact",
				fillInAtCursor,
			}
		}

		// If no exact match, but suggestion is available, check for partial typing
		// The user may have started typing the suggested text
		if (
			fillInAtCursor.text !== "" &&
			prefix.startsWith(fillInAtCursor.prefix) &&
			suffix === fillInAtCursor.suffix
		) {
			// Extract what the user has typed between the original prefix and current position
			const typedContent = prefix.substring(fillInAtCursor.prefix.length)

			// Check if the typed content matches the beginning of the suggestion
			if (fillInAtCursor.text.startsWith(typedContent)) {
				// Return the remaining part of the suggestion (with already-typed portion removed)
				return {
					text: fillInAtCursor.text.substring(typedContent.length),
					matchType: "partial_typing",
					fillInAtCursor,
				}
			}
		}

		// Check for backward deletion: user deleted characters from the end of the prefix
		// The stored prefix should start with the current prefix (current is shorter)
		// Only use this logic if the original suggestion is non-empty
		if (
			fillInAtCursor.text !== "" &&
			fillInAtCursor.prefix.startsWith(prefix) &&
			suffix === fillInAtCursor.suffix
		) {
			// Extract the deleted portion of the prefix
			const deletedContent = fillInAtCursor.prefix.substring(prefix.length)

			// Return the deleted portion plus the original suggestion text
			return {
				text: deletedContent + fillInAtCursor.text,
				matchType: "backward_deletion",
				fillInAtCursor,
			}
		}
	}

	return null
}

/**
 * Transforms a matching suggestion result by applying first-line-only logic if needed.
 * Use this at call sites where you want to show only the first line of multi-line completions
 * when the cursor is in the middle of a line.
 *
 * @param result - The result from findMatchingSuggestion
 * @param prefix - The text before the cursor position
 * @returns A new result with potentially truncated text, or null if input was null
 */
export function applyFirstLineOnly(
	result: MatchingSuggestionWithFillIn | null,
	prefix: string,
): MatchingSuggestionWithFillIn | null {
	if (result === null || result.text === "") {
		return result
	}
	if (shouldShowOnlyFirstLine(prefix, result.text)) {
		const firstLineText = getFirstLine(result.text)
		return {
			text: firstLineText,
			matchType: result.matchType,
			fillInAtCursor: result.fillInAtCursor,
		}
	}
	return result
}

/**
 * Command ID for tracking inline completion acceptance.
 * This command is executed after the user accepts an inline completion.
 */
export const INLINE_COMPLETION_ACCEPTED_COMMAND = "kilocode.ghost.inline-completion.accepted"

/**
 * Counts the number of lines in a text string.
 *
 * Notes:
 * - Returns 0 for an empty string
 * - A single trailing newline (or CRLF) does not count as an additional line
 *
 * @param text - The text to count lines in
 * @returns The number of lines
 */
export function countLines(text: string): number {
	if (text === "") {
		return 0
	}

	// Count line breaks and add 1 for the first line.
	// If the text ends with a line break, don't count the implicit trailing empty line.
	const lineBreakCount = (text.match(/\r?\n/g) || []).length
	const endsWithLineBreak = text.endsWith("\n")

	return lineBreakCount + 1 - (endsWithLineBreak ? 1 : 0)
}

/**
 * Determines if only the first line of a completion should be shown.
 *
 * The logic is:
 * - If the suggestion starts with a newline → show the whole block
 * - If the prefix's last line has non-whitespace text → show only the first line
 * - If at start of line and suggestion is 3+ lines → show only the first line
 * - Otherwise → show the whole block
 *
 * @param prefix - The text before the cursor position
 * @param suggestion - The completion text being suggested
 * @returns true if only the first line should be shown
 */
export function shouldShowOnlyFirstLine(prefix: string, suggestion: string): boolean {
	// If the suggestion starts with a newline, show the whole block
	if (suggestion.startsWith("\n") || suggestion.startsWith("\r\n")) {
		return false
	}

	// Check if the current line (before cursor) has non-whitespace text
	const lastNewlineIndex = prefix.lastIndexOf("\n")
	const currentLinePrefix = prefix.slice(lastNewlineIndex + 1)

	// If the current line prefix contains non-whitespace, only show the first line
	if (currentLinePrefix.trim().length > 0) {
		return true
	}

	// At start of line (only whitespace before cursor on this line)
	// Show only first line if suggestion is 3 or more lines
	const lineCount = countLines(suggestion)
	return lineCount >= 3
}

/**
 * Extracts the first line from a completion text.
 *
 * @param text - The full completion text
 * @returns The first line of the completion (without the newline)
 */
export function getFirstLine(text: string): string {
	return text.split(/\r?\n/, 1)[0]
}

export function stringToInlineCompletions(text: string, position: vscode.Position): vscode.InlineCompletionItem[] {
	if (text === "") {
		return []
	}

	const item = new vscode.InlineCompletionItem(text, new vscode.Range(position, position), {
		command: INLINE_COMPLETION_ACCEPTED_COMMAND,
		title: "Autocomplete Accepted",
	})
	return [item]
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	public suggestionsHistory: FillInAtCursorSuggestion[] = []
	/** Tracks all pending/in-flight requests */
	private pendingRequests: PendingRequest[] = []
	public holeFiller: HoleFiller // publicly exposed for Jetbrains autocomplete code
	public fimPromptBuilder: FimPromptBuilder // publicly exposed for Jetbrains autocomplete code
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private debounceTimer: NodeJS.Timeout | null = null
	private isFirstCall: boolean = true
	private ignoreController?: Promise<RooIgnoreController>
	private acceptedCommand: vscode.Disposable | null = null
	private debounceDelayMs: number = INITIAL_DEBOUNCE_DELAY_MS
	private latencyHistory: number[] = []
	private telemetry: AutocompleteTelemetry | null
	/** Information about the last suggestion shown to the user */
	private lastSuggestion: LastSuggestionInfo | null = null

	constructor(
		context: vscode.ExtensionContext,
		model: GhostModel,
		costTrackingCallback: CostTrackingCallback,
		getSettings: () => GhostServiceSettings | null,
		cline: ClineProvider,
		telemetry: AutocompleteTelemetry | null = null,
	) {
		this.telemetry = telemetry
		this.model = model
		this.costTrackingCallback = costTrackingCallback
		this.getSettings = getSettings

		// Create ignore controller internally
		this.ignoreController = (async () => {
			const ignoreController = new RooIgnoreController(cline.cwd)
			await ignoreController.initialize()
			return ignoreController
		})()

		const ide = new VsCodeIde(context)
		const contextService = new ContextRetrievalService(ide)
		const contextProvider: GhostContextProvider = {
			ide,
			contextService,
			model,
			ignoreController: this.ignoreController,
		}
		this.holeFiller = new HoleFiller(contextProvider)
		this.fimPromptBuilder = new FimPromptBuilder(contextProvider)

		this.recentlyVisitedRangesService = new RecentlyVisitedRangesService(ide)
		this.recentlyEditedTracker = new RecentlyEditedTracker(ide)

		this.acceptedCommand = vscode.commands.registerCommand(INLINE_COMPLETION_ACCEPTED_COMMAND, () =>
			this.telemetry?.captureAcceptSuggestion(this.lastSuggestion?.length),
		)
	}

	public updateSuggestions(fillInAtCursor: FillInAtCursorSuggestion): void {
		const isDuplicate = this.suggestionsHistory.some(
			(existing) =>
				existing.text === fillInAtCursor.text &&
				existing.prefix === fillInAtCursor.prefix &&
				existing.suffix === fillInAtCursor.suffix,
		)

		if (isDuplicate) {
			return
		}

		// Add to the end of the array (most recent)
		this.suggestionsHistory.push(fillInAtCursor)

		// Remove oldest if we exceed the limit
		if (this.suggestionsHistory.length > MAX_SUGGESTIONS_HISTORY) {
			this.suggestionsHistory.shift()
		}
	}

	public async getPrompt(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<{ prompt: GhostPrompt; prefix: string; suffix: string }> {
		// Build complete context with all tracking data
		const recentlyVisitedRanges = this.recentlyVisitedRangesService.getSnippets()
		const recentlyEditedRanges = await this.recentlyEditedTracker.getRecentlyEditedRanges()

		const context: GhostSuggestionContext = {
			document,
			range: new vscode.Range(position, position),
			recentlyVisitedRanges,
			recentlyEditedRanges,
		}

		const autocompleteInput = contextToAutocompleteInput(context)

		const { prefix, suffix } = extractPrefixSuffix(document, position)
		const languageId = document.languageId

		// Determine strategy based on model capabilities and call only the appropriate prompt builder
		const prompt = this.model.supportsFim()
			? await this.fimPromptBuilder.getFimPrompts(autocompleteInput, this.model.getModelName() ?? "codestral")
			: await this.holeFiller.getPrompts(autocompleteInput, languageId)

		return { prompt, prefix, suffix }
	}

	private processSuggestion(
		suggestionText: string,
		prefix: string,
		suffix: string,
		model: GhostModel,
		telemetryContext: AutocompleteContext,
	): FillInAtCursorSuggestion {
		if (!suggestionText) {
			this.telemetry?.captureSuggestionFiltered("empty_response", telemetryContext)
			return { text: "", prefix, suffix }
		}

		const processedText = postprocessGhostSuggestion({
			suggestion: suggestionText,
			prefix,
			suffix,
			model: model.getModelName() || "",
		})

		if (processedText) {
			return { text: processedText, prefix, suffix }
		}

		this.telemetry?.captureSuggestionFiltered("filtered_by_postprocessing", telemetryContext)
		return { text: "", prefix, suffix }
	}

	private async disposeIgnoreController(): Promise<void> {
		if (this.ignoreController) {
			const ignoreController = this.ignoreController
			this.ignoreController = undefined
			;(await ignoreController).dispose()
		}
	}

	/**
	 * Records a latency measurement and updates the adaptive debounce delay.
	 * Maintains a rolling window of the last LATENCY_SAMPLE_SIZE latencies.
	 * Once enough samples are collected, the debounce delay is set to the
	 * average of all stored latencies, clamped between MIN_DEBOUNCE_DELAY_MS
	 * and MAX_DEBOUNCE_DELAY_MS.
	 *
	 * @param latencyMs - The latency of the most recent request in milliseconds
	 */
	public recordLatency(latencyMs: number): void {
		// Add the new latency to the history
		this.latencyHistory.push(latencyMs)

		// Remove oldest if we exceed the sample size
		if (this.latencyHistory.length > LATENCY_SAMPLE_SIZE) {
			this.latencyHistory.shift()

			// Once we have enough samples, update the debounce delay to the average
			const sum = this.latencyHistory.reduce((acc, val) => acc + val, 0)
			const averageLatency = Math.round(sum / this.latencyHistory.length)

			// Clamp the debounce delay between MIN and MAX
			this.debounceDelayMs = Math.max(MIN_DEBOUNCE_DELAY_MS, Math.min(averageLatency, MAX_DEBOUNCE_DELAY_MS))
		}
	}

	public dispose(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		this.telemetry?.dispose()
		this.recentlyVisitedRangesService.dispose()
		this.recentlyEditedTracker.dispose()
		void this.disposeIgnoreController()
		if (this.acceptedCommand) {
			this.acceptedCommand.dispose()
			this.acceptedCommand = null
		}
	}

	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		const settings = this.getSettings()
		const isAutoTriggerEnabled = settings?.enableAutoTrigger ?? false

		if (!isAutoTriggerEnabled) {
			return []
		}

		return this.provideInlineCompletionItems_Internal(document, position, _context, _token)
	}

	public async provideInlineCompletionItems_Internal(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		// Build telemetry context
		const telemetryContext: AutocompleteContext = {
			languageId: document.languageId,
			modelId: this.model?.getModelName(),
			provider: this.model?.getProviderDisplayName(),
		}

		this.telemetry?.captureSuggestionRequested(telemetryContext)

		if (!this.model || !this.model.hasValidCredentials()) {
			// bail if no model is available or no valid API credentials configured
			// this prevents errors when autocomplete is enabled but no provider is set up
			return []
		}

		if (!document?.uri?.fsPath) {
			return []
		}

		try {
			// Check if file is ignored (for manual trigger via codeSuggestion)
			// Skip ignore check for untitled documents
			if (this.ignoreController && !document.isUntitled) {
				try {
					// Try to get the controller with a short timeout
					const controller = await Promise.race([
						this.ignoreController,
						new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
					])

					if (!controller) {
						// If promise hasn't resolved yet, assume file is ignored
						return []
					}

					const isAccessible = controller.validateAccess(document.fileName)
					if (!isAccessible) {
						return []
					}
				} catch (error) {
					console.error("[GhostInlineCompletionProvider] Error checking file access:", error)
					// On error, assume file is ignored
					return []
				}
			}

			const { prefix, suffix } = extractPrefixSuffix(document, position)

			// Check cache first - allow mid-word lookups from cache
			const matchingResult = applyFirstLineOnly(
				findMatchingSuggestion(prefix, suffix, this.suggestionsHistory),
				prefix,
			)

			if (matchingResult !== null) {
				this.lastSuggestion = {
					...telemetryContext,
					length: matchingResult.text.length,
				}
				this.telemetry?.captureCacheHit(matchingResult.matchType, telemetryContext, matchingResult.text.length)
				this.telemetry?.startVisibilityTracking(matchingResult.fillInAtCursor, "cache", telemetryContext)
				return stringToInlineCompletions(matchingResult.text, position)
			}

			this.telemetry?.cancelVisibilityTracking() // No suggestion to show - cancel any pending visibility tracking

			// Only skip new LLM requests during mid-word typing or at end of statement
			// Cache lookups above are still allowed
			if (shouldSkipAutocomplete(prefix, suffix, document.languageId)) {
				return []
			}

			const { prompt, prefix: promptPrefix, suffix: promptSuffix } = await this.getPrompt(document, position)

			// Update context with strategy now that we know it
			telemetryContext.strategy = prompt.strategy

			await this.debouncedFetchAndCacheSuggestion(prompt, promptPrefix, promptSuffix, document.languageId)

			const cachedResult = applyFirstLineOnly(
				findMatchingSuggestion(prefix, suffix, this.suggestionsHistory),
				prefix,
			)
			if (cachedResult) {
				this.lastSuggestion = {
					...telemetryContext,
					length: cachedResult.text.length,
				}
				this.telemetry?.captureLlmSuggestionReturned(telemetryContext, cachedResult.text.length)
				this.telemetry?.startVisibilityTracking(cachedResult.fillInAtCursor, "llm", telemetryContext)
			} else {
				this.telemetry?.cancelVisibilityTracking() // No suggestion to show - cancel any pending visibility tracking
			}

			return stringToInlineCompletions(cachedResult?.text ?? "", position)
		} catch (error) {
			// only big catch at the top of the call-chain, if anything goes wrong at a lower level
			// do not catch, just let the error cascade
			console.error("[GhostInlineCompletionProvider] Error providing inline completion:", error)
			return []
		}
	}

	/**
	 * Find a pending request that covers the current prefix/suffix.
	 * A request covers the current position if:
	 * 1. The suffix matches (user hasn't changed text after cursor)
	 * 2. The current prefix either equals or extends the pending prefix
	 *    (user is typing forward, not backspacing or editing earlier)
	 *
	 * @returns The covering pending request, or null if none found
	 */
	private findCoveringPendingRequest(prefix: string, suffix: string): PendingRequest | null {
		for (const pendingRequest of this.pendingRequests) {
			// Suffix must match exactly (text after cursor unchanged)
			if (suffix !== pendingRequest.suffix) {
				continue
			}

			// Current prefix must start with the pending prefix (user typed more)
			// or be exactly equal (same position)
			if (prefix.startsWith(pendingRequest.prefix)) {
				return pendingRequest
			}
		}
		return null
	}

	/**
	 * Remove a pending request from the list when it completes.
	 */
	private removePendingRequest(request: PendingRequest): void {
		const index = this.pendingRequests.indexOf(request)
		if (index !== -1) {
			this.pendingRequests.splice(index, 1)
		}
	}

	/**
	 * Debounced fetch with leading edge execution and pending request reuse.
	 * - First call executes immediately (leading edge)
	 * - Subsequent calls reset the timer and wait for DEBOUNCE_DELAY_MS of inactivity (trailing edge)
	 * - If a pending request covers the current prefix/suffix, reuse it instead of starting a new one
	 */
	private debouncedFetchAndCacheSuggestion(
		prompt: GhostPrompt,
		prefix: string,
		suffix: string,
		languageId: string,
	): Promise<void> {
		// Check if any existing pending request covers this one
		const coveringRequest = this.findCoveringPendingRequest(prefix, suffix)
		if (coveringRequest) {
			// Wait for the existing request to complete - no need to start a new one
			return coveringRequest.promise
		}

		// If this is the first call (no pending debounce), execute immediately
		if (this.isFirstCall && this.debounceTimer === null) {
			this.isFirstCall = false
			return this.fetchAndCacheSuggestion(prompt, prefix, suffix, languageId)
		}

		// Clear any existing timer (reset the debounce)
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		// Create the pending request object first so we can reference it in the cleanup
		const pendingRequest: PendingRequest = {
			prefix,
			suffix,
			promise: null!, // Will be set immediately below
		}

		const requestPromise = new Promise<void>((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				this.isFirstCall = true // Reset for next sequence
				await this.fetchAndCacheSuggestion(prompt, prefix, suffix, languageId)
				// Remove this request from pending when done
				this.removePendingRequest(pendingRequest)
				resolve()
			}, this.debounceDelayMs)
		})

		// Complete the pending request object
		pendingRequest.promise = requestPromise

		// Add to the list of pending requests
		this.pendingRequests.push(pendingRequest)

		return requestPromise
	}

	public async fetchAndCacheSuggestion(
		prompt: GhostPrompt,
		prefix: string,
		suffix: string,
		languageId: string,
	): Promise<void> {
		const startTime = performance.now()

		// Build telemetry context for this request
		const telemetryContext: AutocompleteContext = {
			languageId,
			modelId: this.model?.getModelName(),
			provider: this.model?.getProviderDisplayName(),
			strategy: prompt.strategy,
		}

		// Defense-in-depth: credentials may become invalid between the provider gate and the actual
		// debounced execution (e.g., profile reload calling GhostModel.cleanup()).
		// In that case, do not attempt an LLM call at all.
		if (!this.model || !this.model.hasValidCredentials()) {
			return
		}

		try {
			// Curry processSuggestion with prefix, suffix, model, and telemetry context
			const curriedProcessSuggestion = (text: string) =>
				this.processSuggestion(text, prefix, suffix, this.model, telemetryContext)

			const result =
				prompt.strategy === "fim"
					? await this.fimPromptBuilder.getFromFIM(this.model, prompt, curriedProcessSuggestion)
					: await this.holeFiller.getFromChat(this.model, prompt, curriedProcessSuggestion)

			const latencyMs = performance.now() - startTime

			this.telemetry?.captureLlmRequestCompleted(
				{
					latencyMs,
					cost: result.cost,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				},
				telemetryContext,
			)

			// Record latency for adaptive debounce delay
			this.recordLatency(latencyMs)

			this.costTrackingCallback(result.cost, result.inputTokens, result.outputTokens)

			// Always update suggestions, even if text is empty (for caching)
			this.updateSuggestions(result.suggestion)
		} catch (error) {
			const latencyMs = performance.now() - startTime
			this.telemetry?.captureLlmRequestFailed(
				{
					latencyMs,
					error: error instanceof Error ? error.message : String(error),
				},
				telemetryContext,
			)
			console.error("Error getting inline completion from LLM:", error)
		}
	}
}
