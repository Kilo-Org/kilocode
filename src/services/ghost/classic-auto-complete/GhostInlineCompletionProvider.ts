import * as vscode from "vscode"
import { extractPrefixSuffix, GhostSuggestionContext, contextToAutocompleteInput } from "../types"
import { GhostContextProvider } from "./GhostContextProvider"
import { HoleFiller, FillInAtCursorSuggestion, HoleFillerGhostPrompt } from "./HoleFiller"
import { FimPromptBuilder, FimGhostPrompt } from "./FillInTheMiddle"
import { GhostModel } from "../GhostModel"
import { RecentlyVisitedRangesService } from "../../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService"
import { RecentlyEditedTracker } from "../../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited"
import type { GhostServiceSettings } from "@roo-code/types"
import { postprocessGhostSuggestion } from "./uselessSuggestionFilter"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import * as telemetry from "./AutocompleteTelemetry"
import type { AutocompleteContext, CacheMatchType } from "./AutocompleteTelemetry"

const MAX_SUGGESTIONS_HISTORY = 20
const DEBOUNCE_DELAY_MS = 300

export type CostTrackingCallback = (cost: number, inputTokens: number, outputTokens: number) => void

export type GhostPrompt = FimGhostPrompt | HoleFillerGhostPrompt

/**
 * Result of finding a matching suggestion, includes the match type for telemetry
 */
export interface MatchingSuggestionResult {
	text: string
	matchType: CacheMatchType
}

/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion with match type, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): MatchingSuggestionResult | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// First, try exact prefix/suffix match
		if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
			return { text: fillInAtCursor.text, matchType: "exact" }
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
				return { text: fillInAtCursor.text.substring(typedContent.length), matchType: "partial_typing" }
			}
		}

		// Check for backward deletion: user deleted characters from the end of the prefix
		// The stored prefix should start with the current prefix (current is shorter)
		if (fillInAtCursor.prefix.startsWith(prefix) && suffix === fillInAtCursor.suffix) {
			// Extract the deleted portion of the prefix
			const deletedContent = fillInAtCursor.prefix.substring(prefix.length)

			// Return the deleted portion plus the original suggestion text
			return { text: deletedContent + fillInAtCursor.text, matchType: "backward_deletion" }
		}
	}

	return null
}

/**
 * Command ID for tracking inline completion acceptance.
 * This command is executed after the user accepts an inline completion.
 */
export const INLINE_COMPLETION_ACCEPTED_COMMAND = "kilocode.ghost.inline-completion.accepted"

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

export interface LLMRetrievalResult {
	suggestion: FillInAtCursorSuggestion
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

/**
 * Represents a pending/in-flight request that can be reused if the user
 * continues typing in a way that's compatible with the pending completion.
 */
interface PendingRequest {
	/** The prefix that was used to start this request */
	prefix: string
	/** The suffix that was used to start this request */
	suffix: string
	/** Promise that resolves when the request completes */
	promise: Promise<void>
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []
	/** Tracks all pending/in-flight requests */
	private pendingRequests: PendingRequest[] = []
	private holeFiller: HoleFiller
	private fimPromptBuilder: FimPromptBuilder
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private debounceTimer: NodeJS.Timeout | null = null
	private isFirstCall: boolean = true
	private ignoreController?: Promise<RooIgnoreController>
	private acceptedCommand: vscode.Disposable | null = null

	constructor(
		context: vscode.ExtensionContext,
		model: GhostModel,
		costTrackingCallback: CostTrackingCallback,
		getSettings: () => GhostServiceSettings | null,
		cline: ClineProvider,
	) {
		this.model = model
		this.costTrackingCallback = costTrackingCallback
		this.getSettings = getSettings

		// Create ignore controller internally
		this.ignoreController = (async () => {
			const ignoreController = new RooIgnoreController(cline.cwd)
			await ignoreController.initialize()
			return ignoreController
		})()

		const contextProvider = new GhostContextProvider(context, model, this.ignoreController)
		this.holeFiller = new HoleFiller(contextProvider)
		this.fimPromptBuilder = new FimPromptBuilder(contextProvider)

		const ide = contextProvider.getIde()
		this.recentlyVisitedRangesService = new RecentlyVisitedRangesService(ide)
		this.recentlyEditedTracker = new RecentlyEditedTracker(ide)

		this.acceptedCommand = vscode.commands.registerCommand(INLINE_COMPLETION_ACCEPTED_COMMAND, () =>
			telemetry.captureAcceptSuggestion(),
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

	private async getPrompt(
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
			telemetry.captureSuggestionFiltered("empty_response", telemetryContext)
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

		telemetry.captureSuggestionFiltered("filtered_by_postprocessing", telemetryContext)
		return { text: "", prefix, suffix }
	}

	private async disposeIgnoreController(): Promise<void> {
		if (this.ignoreController) {
			const ignoreController = this.ignoreController
			this.ignoreController = undefined
			;(await ignoreController).dispose()
		}
	}

	public dispose(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
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

		telemetry.captureSuggestionRequested(telemetryContext)

		if (!this.model) {
			// bail if no model is available, because if there is none, we also have no cache
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

			const matchingResult = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

			if (matchingResult !== null) {
				telemetry.captureCacheHit(matchingResult.matchType, telemetryContext, matchingResult.text.length)
				return stringToInlineCompletions(matchingResult.text, position)
			}

			const { prompt, prefix: promptPrefix, suffix: promptSuffix } = await this.getPrompt(document, position)

			// Update context with strategy now that we know it
			telemetryContext.strategy = prompt.strategy

			await this.debouncedFetchAndCacheSuggestion(prompt, promptPrefix, promptSuffix, document.languageId)

			const cachedResult = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)
			if (cachedResult) {
				telemetry.captureLlmSuggestionReturned(telemetryContext, cachedResult.text.length)
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
			}, DEBOUNCE_DELAY_MS)
		})

		// Complete the pending request object
		pendingRequest.promise = requestPromise

		// Add to the list of pending requests
		this.pendingRequests.push(pendingRequest)

		return requestPromise
	}

	private async fetchAndCacheSuggestion(
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

		try {
			// Curry processSuggestion with prefix, suffix, model, and telemetry context
			const curriedProcessSuggestion = (text: string) =>
				this.processSuggestion(text, prefix, suffix, this.model, telemetryContext)

			const result =
				prompt.strategy === "fim"
					? await this.fimPromptBuilder.getFromFIM(this.model, prompt, curriedProcessSuggestion)
					: await this.holeFiller.getFromChat(this.model, prompt, curriedProcessSuggestion)

			const latencyMs = performance.now() - startTime

			telemetry.captureLlmRequestCompleted(
				{
					latencyMs,
					cost: result.cost,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				},
				telemetryContext,
			)

			this.costTrackingCallback(result.cost, result.inputTokens, result.outputTokens)

			// Always update suggestions, even if text is empty (for caching)
			this.updateSuggestions(result.suggestion)
		} catch (error) {
			const latencyMs = performance.now() - startTime
			telemetry.captureLlmRequestFailed(
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
