import * as vscode from "vscode"
import { extractPrefixSuffix, GhostSuggestionContext, contextToAutocompleteInput } from "../types"
import { GhostContextProvider } from "./GhostContextProvider"
import { parseGhostResponse, HoleFiller, FillInAtCursorSuggestion } from "./HoleFiller"
import { GhostModel } from "../GhostModel"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { RecentlyVisitedRangesService } from "../../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService"
import { RecentlyEditedTracker } from "../../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited"
import type { GhostServiceSettings } from "@roo-code/types"
import { postprocessGhostSuggestion } from "./uselessSuggestionFilter"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"

const MAX_SUGGESTIONS_HISTORY = 20
const DEBOUNCE_DELAY_MS = 300

export type CostTrackingCallback = (
	cost: number,
	inputTokens: number,
	outputTokens: number,
	cacheWriteTokens: number,
	cacheReadTokens: number,
) => void

export interface GhostPrompt {
	systemPrompt: string
	userPrompt: string
	prefix: string
	suffix: string
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
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private debounceTimer: NodeJS.Timeout | null = null
	private ignoreController?: Promise<RooIgnoreController>

	constructor(
		model: GhostModel,
		costTrackingCallback: CostTrackingCallback,
		getSettings: () => GhostServiceSettings | null,
		contextProvider?: GhostContextProvider,
		ignoreController?: Promise<RooIgnoreController>,
	) {
		this.model = model
		this.costTrackingCallback = costTrackingCallback
		this.getSettings = getSettings
		this.holeFiller = new HoleFiller(contextProvider)
		this.ignoreController = ignoreController

		// Get IDE from context provider if available
		const ide = contextProvider?.getIde()
		if (ide) {
			this.recentlyVisitedRangesService = new RecentlyVisitedRangesService(ide)
			this.recentlyEditedTracker = new RecentlyEditedTracker(ide)
		} else {
			throw new Error("GhostContextProvider with IDE is required for tracking services")
		}
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

	private async getPrompt(document: vscode.TextDocument, position: vscode.Position): Promise<GhostPrompt> {
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

		const { systemPrompt, userPrompt } = await this.holeFiller.getPrompts(
			autocompleteInput,
			prefix,
			suffix,
			languageId,
		)

		return { systemPrompt, userPrompt, prefix, suffix }
	}

	public async getFromLLM(prompt: GhostPrompt, model: GhostModel): Promise<LLMRetrievalResult> {
		const { systemPrompt, userPrompt, prefix, suffix } = prompt

		let response = ""

		// Create streaming callback
		const onChunk = (chunk: ApiStreamChunk) => {
			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		// Start streaming generation
		const usageInfo = await model.generateResponse(systemPrompt, userPrompt, onChunk)

		console.log("response", response)

		// Parse the response using the standalone function
		const parsedSuggestion = parseGhostResponse(response, prefix, suffix)

		// Process the suggestion through the postprocessing pipeline
		let fillInAtCursorSuggestion: FillInAtCursorSuggestion
		if (parsedSuggestion.text) {
			const processedText = postprocessGhostSuggestion({
				suggestion: parsedSuggestion.text,
				prefix,
				suffix,
				model: model.getModelName() || "",
			})

			if (processedText) {
				fillInAtCursorSuggestion = { text: processedText, prefix, suffix }
				console.info("Final suggestion:", fillInAtCursorSuggestion)
			} else {
				// Suggestion was filtered out
				fillInAtCursorSuggestion = { text: "", prefix, suffix }
			}
		} else {
			// No suggestion from parsing
			fillInAtCursorSuggestion = { text: "", prefix, suffix }
		}

		// Always return a FillInAtCursorSuggestion, even if text is empty
		return {
			suggestion: fillInAtCursorSuggestion,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
		}
	}

	public dispose(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
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

		// Check if file is ignored (for manual trigger via codeSuggestion)
		if (!document.isUntitled && this.ignoreController) {
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

		const prompt = await this.getPrompt(document, position)
		await this.debouncedFetchAndCacheSuggestion(prompt)

		const cachedText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)
		return stringToInlineCompletions(cachedText ?? "", position)
	}

	private debouncedFetchAndCacheSuggestion(prompt: GhostPrompt): Promise<void> {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		return new Promise<void>((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				await this.fetchAndCacheSuggestion(prompt)
				resolve()
			}, DEBOUNCE_DELAY_MS)
		})
	}

	private async fetchAndCacheSuggestion(prompt: GhostPrompt): Promise<void> {
		try {
			const result = await this.getFromLLM(prompt, this.model)

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
		} catch (error) {
			console.error("Error getting inline completion from LLM:", error)
		}
	}
}
