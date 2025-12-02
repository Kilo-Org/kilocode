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

type SuggestionHistoryEntry = FillInAtCursorSuggestion & {
	/**
	 * When true, this entry represents an in-flight request (placeholder).
	 * It should not be treated as a cached result by lookups.
	 */
	isPartial?: boolean
	/**
	 * Promise that resolves when the in-flight request completes.
	 */
	requestDone?: Promise<void>
}

type PendingSuggestionRequest = {
	prefix: string
	suffix: string
	done: Promise<void>
	resolveDone: () => void
	entry: SuggestionHistoryEntry
}

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
	suggestionsHistory: ReadonlyArray<SuggestionHistoryEntry>,
): string | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// Skip in-flight placeholder entries
		if (fillInAtCursor.isPartial) {
			continue
		}

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
	private suggestionsHistory: SuggestionHistoryEntry[] = []
	private pendingSuggestionRequest: PendingSuggestionRequest | null = null
	private holeFiller: HoleFiller
	private fimPromptBuilder: FimPromptBuilder
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private debounceTimer: NodeJS.Timeout | null = null
	private ignoreController?: Promise<RooIgnoreController>

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
		// If there's an in-flight (partial) request for a "longer or equal" prefix
		// and the new prefix is the same as, or a prefix of, that in-flight prefix,
		// then do not start a new request.
		if (
			this.pendingSuggestionRequest &&
			this.pendingSuggestionRequest.suffix === suffix &&
			(this.pendingSuggestionRequest.prefix === prefix || this.pendingSuggestionRequest.prefix.startsWith(prefix))
		) {
			return this.pendingSuggestionRequest.done
		}

		// If we are about to start a new request, make sure any previously scheduled request
		// doesn't leave an unresolved promise behind.
		if (this.pendingSuggestionRequest) {
			this.pendingSuggestionRequest.entry.isPartial = false
			this.pendingSuggestionRequest.resolveDone()
			this.pendingSuggestionRequest = null
		}

		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		let resolveDone: () => void
		const done = new Promise<void>((resolve) => {
			resolveDone = resolve
		})

		const entry: SuggestionHistoryEntry = {
			text: "",
			prefix,
			suffix,
			isPartial: true,
			requestDone: done,
		}

		// Add partial entry immediately
		this.suggestionsHistory.push(entry)

		// Remove oldest if we exceed the limit
		if (this.suggestionsHistory.length > MAX_SUGGESTIONS_HISTORY) {
			this.suggestionsHistory.shift()
		}

		const request: PendingSuggestionRequest = {
			prefix,
			suffix,
			done,
			resolveDone: resolveDone!,
			entry,
		}
		this.pendingSuggestionRequest = request

		this.debounceTimer = setTimeout(async () => {
			this.debounceTimer = null
			try {
				await this.fetchAndCacheSuggestion(prompt, prefix, suffix, request)
			} finally {
				// Complete the request entry + promise regardless of success/failure
				request.entry.isPartial = false
				request.resolveDone()

				// Only clear if this is still the active request
				if (this.pendingSuggestionRequest === request) {
					this.pendingSuggestionRequest = null
				}
			}
		}, DEBOUNCE_DELAY_MS)

		return done
	}

	private async fetchAndCacheSuggestion(
		prompt: GhostPrompt,
		prefix: string,
		suffix: string,
		request?: PendingSuggestionRequest,
	): Promise<void> {
		try {
			// Curry processSuggestion with prefix, suffix, and model - only text needs to be provided
			const curriedProcessSuggestion = (text: string) => this.processSuggestion(text, prefix, suffix, this.model)

			const result =
				prompt.strategy === "fim"
					? await this.fimPromptBuilder.getFromFIM(this.model, prompt, curriedProcessSuggestion)
					: await this.holeFiller.getFromChat(this.model, prompt, curriedProcessSuggestion)

			this.costTrackingCallback(
				result.cost,
				result.inputTokens,
				result.outputTokens,
				result.cacheWriteTokens,
				result.cacheReadTokens,
			)

			// If this completion corresponds to the in-flight placeholder entry, update it in-place
			// so the history doesn't end up with duplicate entries.
			if (request) {
				request.entry.text = result.suggestion.text
				request.entry.prefix = result.suggestion.prefix
				request.entry.suffix = result.suggestion.suffix
				request.entry.isPartial = false
				return
			}

			// Always update suggestions, even if text is empty (for caching)
			this.updateSuggestions(result.suggestion)
		} catch (error) {
			// If we were fulfilling an in-flight placeholder, complete it as "empty"
			if (request) {
				request.entry.text = ""
				request.entry.isPartial = false
			}
			console.error("Error getting inline completion from LLM:", error)
		}
	}
}
