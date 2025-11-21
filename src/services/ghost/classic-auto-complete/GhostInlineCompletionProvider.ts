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
import { RequestDebouncer } from "./RequestDebouncer"
import { RequestDeduplicator, type PendingRequest } from "./RequestDeduplicator"

const MAX_SUGGESTIONS_HISTORY = 20
const DEBOUNCE_DELAY_MS = 300

export type CostTrackingCallback = (
	cost: number,
	inputTokens: number,
	outputTokens: number,
	cacheWriteTokens: number,
	cacheReadTokens: number,
) => void

export type GhostPrompt = FimGhostPrompt | HoleFillerGhostPrompt

/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion text, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): string | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// First, try exact prefix/suffix match
		if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
			return fillInAtCursor.text
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
				return fillInAtCursor.text.substring(typedContent.length)
			}
		}
	}

	return null
}

export function stringToInlineCompletions(text: string, position: vscode.Position): vscode.InlineCompletionItem[] {
	if (text === "") {
		return []
	}

	const item: vscode.InlineCompletionItem = {
		insertText: text,
		range: new vscode.Range(position, position),
	}
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

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []
	private holeFiller: HoleFiller
	private fimPromptBuilder: FimPromptBuilder
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private ignoreController?: Promise<RooIgnoreController>
	private debouncer: RequestDebouncer = new RequestDebouncer()
	private deduplicator: RequestDeduplicator = new RequestDeduplicator()

	constructor(
		model: GhostModel,
		costTrackingCallback: CostTrackingCallback,
		getSettings: () => GhostServiceSettings | null,
		contextProvider: GhostContextProvider,
		ignoreController?: Promise<RooIgnoreController>,
	) {
		this.model = model
		this.costTrackingCallback = costTrackingCallback
		this.getSettings = getSettings
		this.holeFiller = new HoleFiller(contextProvider)
		this.fimPromptBuilder = new FimPromptBuilder(contextProvider)
		this.ignoreController = ignoreController

		// Initialize tracking services with IDE from context provider
		const ide = contextProvider.getIde()
		this.recentlyVisitedRangesService = new RecentlyVisitedRangesService(ide)
		this.recentlyEditedTracker = new RecentlyEditedTracker(ide)
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
	): FillInAtCursorSuggestion {
		if (!suggestionText) {
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

		return { text: "", prefix, suffix }
	}

	public dispose(): void {
		this.debouncer.clear()
		this.deduplicator.clear()
		this.recentlyVisitedRangesService.dispose()
		this.recentlyEditedTracker.dispose()
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

			const matchingText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

			if (matchingText !== null) {
				return stringToInlineCompletions(matchingText, position)
			}

			const { prompt, prefix: promptPrefix, suffix: promptSuffix } = await this.getPrompt(document, position)
			await this.debouncedFetchAndCacheSuggestion(prompt, promptPrefix, promptSuffix)

			const cachedText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)
			return stringToInlineCompletions(cachedText ?? "", position)
		} catch (error) {
			// only big catch at the top of the call-chain, if anything goes wrong at a lower level
			// do not catch, just let the error cascade
			console.error("[GhostInlineCompletionProvider] Error providing inline completion:", error)
			return []
		}
	}

	private debouncedFetchAndCacheSuggestion(prompt: GhostPrompt, prefix: string, suffix: string): Promise<void> {
		return this.debouncer.debounce(() => this.fetchAndCacheSuggestion(prompt, prefix, suffix), DEBOUNCE_DELAY_MS)
	}

	/**
	 * Adjust a suggestion when user has typed ahead
	 */
	private adjustSuggestion(suggestion: string, originalPrefix: string, currentPrefix: string): string | null {
		if (!currentPrefix.startsWith(originalPrefix)) {
			return null // Can't adjust
		}

		const typedAhead = currentPrefix.slice(originalPrefix.length)
		if (!suggestion.startsWith(typedAhead)) {
			return null // Suggestion doesn't match
		}

		return suggestion.slice(typedAhead.length)
	}

	/**
	 * Handle errors from aborted requests
	 */
	private isAbortError(error: unknown): boolean {
		return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))
	}

	private async fetchAndCacheSuggestion(prompt: GhostPrompt, prefix: string, suffix: string): Promise<void> {
		// Check if we can reuse an existing pending request
		const reusable = this.deduplicator.findReusable(prefix, suffix)
		if (reusable) {
			try {
				const result = await reusable.promise

				// Check if request was aborted while waiting
				if (reusable.abortController.signal.aborted) {
					return
				}

				// If user typed ahead, adjust the suggestion
				if (prefix !== reusable.prefix) {
					const adjusted = this.adjustSuggestion(result.suggestion.text, reusable.prefix, prefix)
					if (adjusted !== null) {
						this.updateSuggestions({ text: adjusted, prefix, suffix })
						return
					}
				}

				// Use the result as-is if no adjustment needed
				this.updateSuggestions(result.suggestion)
				return
			} catch (error) {
				if (this.isAbortError(error)) {
					return
				}
				console.warn("Reused request failed, creating new request:", error)
			}
		}

		// Cancel any pending requests that are now obsolete
		this.deduplicator.cancelObsolete(prefix, suffix)

		// Create new request
		const abortController = new AbortController()
		const promise = this.executeRequest(prompt, prefix, suffix, abortController)

		// Store the pending request
		const request: PendingRequest = {
			prefix,
			suffix,
			promise,
			abortController,
		}
		this.deduplicator.add(prefix, suffix, request)

		try {
			await promise
		} catch (error) {
			if (this.isAbortError(error)) {
				return
			}
			console.error("Error getting inline completion from LLM:", error)
		}
	}

	/**
	 * Execute the actual LLM request
	 */
	private async executeRequest(
		prompt: GhostPrompt,
		prefix: string,
		suffix: string,
		abortController: AbortController,
	): Promise<LLMRetrievalResult> {
		try {
			// Check if already aborted before starting
			if (abortController.signal.aborted) {
				throw new Error("Request aborted before starting")
			}

			// Curry processSuggestion with prefix, suffix, and model
			const curriedProcessSuggestion = (text: string) => this.processSuggestion(text, prefix, suffix, this.model)

			const result =
				prompt.strategy === "fim"
					? await this.fimPromptBuilder.getFromFIM(this.model, prompt, curriedProcessSuggestion)
					: await this.holeFiller.getFromChat(this.model, prompt, curriedProcessSuggestion)

			// Check if aborted after completion
			if (abortController.signal.aborted) {
				throw new Error("Request aborted after completion")
			}

			if (this.costTrackingCallback && result.cost > 0) {
				this.costTrackingCallback(
					result.cost,
					result.inputTokens,
					result.outputTokens,
					result.cacheWriteTokens,
					result.cacheReadTokens,
				)
			}

			// Always update suggestions, even if text is empty (for caching)
			this.updateSuggestions(result.suggestion)

			return result
		} finally {
			// Clean up from pending requests map
			this.deduplicator.remove(prefix, suffix)
		}
	}
}
