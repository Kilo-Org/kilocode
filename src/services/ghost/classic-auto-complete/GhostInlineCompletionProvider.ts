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
import { GhostGeneratorReuseManager } from "./GhostGeneratorReuseManager"

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
	private debounceTimer: NodeJS.Timeout | null = null
	private ignoreController?: Promise<RooIgnoreController>
	private generatorReuseManager: GhostGeneratorReuseManager

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

		// Initialize generator reuse manager
		this.generatorReuseManager = new GhostGeneratorReuseManager((err) => {
			console.error("[GhostInlineCompletionProvider] Generator error:", err)
		})
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
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		this.generatorReuseManager.cancel()
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

			// First, check if we have a cached suggestion that matches
			const matchingText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

			if (matchingText !== null) {
				return stringToInlineCompletions(matchingText, position)
			}

			// Check if we can reuse an existing generator
			if (this.generatorReuseManager.shouldReuseExistingGenerator(prefix, suffix)) {
				// Wait for the pending generator to complete and get the result
				const result = await this.generatorReuseManager.getCompletion(
					prefix,
					suffix,
					// These won't be used since we're reusing
					{ strategy: "fim" } as GhostPrompt,
					() => {
						throw new Error("Should not create new generator when reusing")
					},
				)

				if (result.text) {
					// Process and cache the suggestion
					const suggestion = this.processSuggestion(
						result.text,
						result.originalPrefix,
						result.originalSuffix,
						this.model,
					)
					this.updateSuggestions(suggestion)

					// Return the stripped text for the current position
					const strippedText = this.stripTypedCharacters(prefix, result.originalPrefix, suggestion.text)
					return stringToInlineCompletions(strippedText, position)
				}
			}

			// No reusable generator, start a new one with debouncing
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
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		return new Promise<void>((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				await this.fetchAndCacheSuggestionWithReuse(prompt, prefix, suffix)
				resolve()
			}, DEBOUNCE_DELAY_MS)
		})
	}

	/**
	 * Fetch a suggestion using the generator reuse manager.
	 * This method creates a streaming generator and waits for it to complete.
	 */
	private async fetchAndCacheSuggestionWithReuse(prompt: GhostPrompt, prefix: string, suffix: string): Promise<void> {
		try {
			// Create a generator factory based on the prompt strategy
			const generatorFactory = (abortSignal: AbortSignal): AsyncGenerator<string> => {
				if (prompt.strategy === "fim") {
					return this.fimPromptBuilder.createStreamingGenerator(this.model, prompt, abortSignal)
				} else {
					return this.holeFiller.createStreamingGenerator(this.model, prompt, abortSignal)
				}
			}

			// Use the generator reuse manager to get the completion
			const result = await this.generatorReuseManager.getCompletion(prefix, suffix, prompt, generatorFactory)

			// Get the full accumulated text
			let suggestionText = result.text

			// For hole filler (chat), we need to extract the completion from XML tags
			if (prompt.strategy === "hole_filler") {
				suggestionText = HoleFiller.extractCompletionText(suggestionText)
			}

			// Process the suggestion
			const suggestion = this.processSuggestion(suggestionText, prefix, suffix, this.model)

			// Track costs - we only have usage info when the generator completes
			// For now, we'll track costs separately when we have access to usage info
			// TODO: Capture usage info from the generator return value

			// Always update suggestions, even if text is empty (for caching)
			this.updateSuggestions(suggestion)
		} catch (error) {
			console.error("Error getting inline completion from LLM:", error)
		}
	}

	/**
	 * Legacy method for fetching suggestions without generator reuse.
	 * Kept for reference and potential fallback.
	 */
	private async fetchAndCacheSuggestion(prompt: GhostPrompt, prefix: string, suffix: string): Promise<void> {
		try {
			// Curry processSuggestion with prefix, suffix, and model - only text needs to be provided
			const curriedProcessSuggestion = (text: string) => this.processSuggestion(text, prefix, suffix, this.model)

			const result =
				prompt.strategy === "fim"
					? await this.fimPromptBuilder.getFromFIM(this.model, prompt, curriedProcessSuggestion)
					: await this.holeFiller.getFromChat(this.model, prompt, curriedProcessSuggestion)

			if (this.costTrackingCallback) {
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
		} catch (error) {
			console.error("Error getting inline completion from LLM:", error)
		}
	}

	/**
	 * Strip characters that the user has already typed from the completion
	 */
	private stripTypedCharacters(currentPrefix: string, originalPrefix: string, completion: string): string {
		// What the user typed since the generation started
		const typedSinceGenerator = currentPrefix.slice(originalPrefix.length)

		let result = completion
		let typed = typedSinceGenerator

		// Strip matching prefix
		while (result.length > 0 && typed.length > 0) {
			if (result[0] === typed[0]) {
				result = result.slice(1)
				typed = typed.slice(1)
			} else {
				// Mismatch - stop stripping
				break
			}
		}

		return result
	}
}
