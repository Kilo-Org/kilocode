import * as vscode from "vscode"
import { FillInAtCursorSuggestion, GhostSuggestionsState } from "./GhostSuggestions"
import { extractPrefixSuffix, GhostSuggestionContext, contextToAutocompleteInput } from "../types"
import { parseGhostResponse } from "./GhostStreamingParser"
import { AutoTriggerStrategy } from "./AutoTriggerStrategy"
import { GhostModel } from "../GhostModel"
import { GhostContext } from "../GhostContext"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { GhostGutterAnimation } from "../GhostGutterAnimation"
import { GhostServiceSettings } from "@roo-code/types"

const MAX_SUGGESTIONS_HISTORY = 20

export type CostTrackingCallback = (
	cost: number,
	inputTokens: number,
	outputTokens: number,
	cacheWriteTokens: number,
	cacheReadTokens: number,
) => void

/**
 * Result of finding a matching suggestion
 */
export interface MatchingSuggestionResult {
	text: string
	originalSuggestion: FillInAtCursorSuggestion
}

/**
 * Check if a character is an auto-closing bracket/quote
 */
function isAutoClosingChar(char: string): boolean {
	return [")", "]", "}", ">", '"', "'", "`"].includes(char)
}

/**
 * Remove auto-inserted bracket from the start of suffix if present
 * @param suffix - The text after the cursor position
 * @returns The suffix with any auto-inserted bracket removed
 */
function removePotentialAutoBracket(suffix: string): string {
	return suffix.length > 0 && isAutoClosingChar(suffix[0]) ? suffix.substring(1) : suffix
}

/**
 * Check if prefix and suffix match, considering potential auto-inserted brackets
 * @param prefix - Current prefix to check
 * @param suffix - Current suffix to check
 * @param expectedPrefix - Expected prefix from cached suggestion
 * @param expectedSuffix - Expected suffix from cached suggestion
 * @returns Object with match status and cleaned suffix
 */
function checkPrefixSuffixMatch(
	prefix: string,
	suffix: string,
	expectedPrefix: string,
	expectedSuffix: string,
): { matches: boolean; cleanedSuffix: string } {
	const cleanedSuffix = removePotentialAutoBracket(suffix)

	// Check exact match first
	if (prefix === expectedPrefix && suffix === expectedSuffix) {
		return { matches: true, cleanedSuffix: suffix }
	}

	// Check match with auto-bracket removed
	if (prefix === expectedPrefix && cleanedSuffix === expectedSuffix) {
		return { matches: true, cleanedSuffix }
	}

	return { matches: false, cleanedSuffix }
}

/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion result with text and original suggestion, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): MatchingSuggestionResult | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// Check for exact match (with or without auto-inserted bracket)
		const exactMatch = checkPrefixSuffixMatch(prefix, suffix, fillInAtCursor.prefix, fillInAtCursor.suffix)
		if (exactMatch.matches) {
			return {
				text: fillInAtCursor.text,
				originalSuggestion: fillInAtCursor,
			}
		}

		// Check for partial typing - user may have started typing the suggested text
		if (prefix.startsWith(fillInAtCursor.prefix)) {
			const partialMatch = checkPrefixSuffixMatch(prefix, suffix, fillInAtCursor.prefix, fillInAtCursor.suffix)

			// Only proceed if suffix matches (with or without auto-bracket)
			if (partialMatch.cleanedSuffix === fillInAtCursor.suffix) {
				// Extract what the user has typed between the original prefix and current position
				const typedContent = prefix.substring(fillInAtCursor.prefix.length)

				// Check if the typed content matches the beginning of the suggestion
				if (fillInAtCursor.text.startsWith(typedContent)) {
					// Return the remaining part of the suggestion (with already-typed portion removed)
					return {
						text: fillInAtCursor.text.substring(typedContent.length),
						originalSuggestion: fillInAtCursor,
					}
				}
			}
		}
	}

	return null
}

export interface LLMRetrievalResult {
	suggestions: GhostSuggestionsState
	cost: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []
	private autoTriggerStrategy: AutoTriggerStrategy
	private isRequestCancelled: boolean = false
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private ghostContext: GhostContext
	private cursorAnimation: GhostGutterAnimation
	private settings: GhostServiceSettings | null = null

	constructor(
		model: GhostModel,
		costTrackingCallback: CostTrackingCallback,
		ghostContext: GhostContext,
		cursorAnimation: GhostGutterAnimation,
	) {
		this.model = model
		this.costTrackingCallback = costTrackingCallback
		this.ghostContext = ghostContext
		this.cursorAnimation = cursorAnimation
		this.autoTriggerStrategy = new AutoTriggerStrategy()
	}

	public updateSettings(settings: GhostServiceSettings | null): void {
		this.settings = settings
	}

	/**
	 * Check if a cached suggestion is available for the given prefix and suffix
	 * @param prefix - The text before the cursor position
	 * @param suffix - The text after the cursor position
	 * @returns True if a matching suggestion exists, false otherwise
	 */
	public cachedSuggestionAvailable(prefix: string, suffix: string): boolean {
		return findMatchingSuggestion(prefix, suffix, this.suggestionsHistory) !== null
	}

	public updateSuggestions(suggestions: GhostSuggestionsState): void {
		const fillInAtCursor = suggestions.getFillInAtCursor()

		if (!fillInAtCursor) {
			return
		}

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

	/**
	 * Retrieve suggestions from LLM
	 * @param context - The suggestion context
	 * @param model - The Ghost model to use for generation
	 * @returns LLM retrieval result with suggestions and usage info
	 */
	public async getFromLLM(context: GhostSuggestionContext, model: GhostModel): Promise<LLMRetrievalResult> {
		this.isRequestCancelled = false

		const autocompleteInput = contextToAutocompleteInput(context)

		const position = context.range?.start ?? context.document.positionAt(0)
		const { prefix, suffix } = extractPrefixSuffix(context.document, position)
		const languageId = context.document.languageId

		// Check cache before making API call
		if (this.cachedSuggestionAvailable(prefix, suffix)) {
			// Return empty result if cached suggestion is available
			return {
				suggestions: new GhostSuggestionsState(),
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}
		}

		const { systemPrompt, userPrompt } = this.autoTriggerStrategy.getPrompts(
			autocompleteInput,
			prefix,
			suffix,
			languageId,
		)

		if (this.isRequestCancelled) {
			return {
				suggestions: new GhostSuggestionsState(),
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}
		}

		let response = ""

		// Create streaming callback
		const onChunk = (chunk: ApiStreamChunk) => {
			if (this.isRequestCancelled) {
				return
			}

			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		// Start streaming generation
		const usageInfo = await model.generateResponse(systemPrompt, userPrompt, onChunk)

		console.log("response", response)

		if (this.isRequestCancelled) {
			return {
				suggestions: new GhostSuggestionsState(),
				cost: usageInfo.cost,
				inputTokens: usageInfo.inputTokens,
				outputTokens: usageInfo.outputTokens,
				cacheWriteTokens: usageInfo.cacheWriteTokens,
				cacheReadTokens: usageInfo.cacheReadTokens,
			}
		}

		// Parse the response using the standalone function
		const finalParseResult = parseGhostResponse(response, prefix, suffix)

		if (finalParseResult.suggestions.getFillInAtCursor()) {
			console.info("Final suggestion:", finalParseResult.suggestions.getFillInAtCursor())
		}

		return {
			suggestions: finalParseResult.suggestions,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
		}
	}

	/**
	 * Cancel any ongoing LLM request
	 */
	public cancelRequest(): void {
		this.isRequestCancelled = true
	}

	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		const { prefix, suffix } = extractPrefixSuffix(document, position)

		const matchingResult = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

		if (matchingResult !== null) {
			// Check if suffix has a new auto-inserted bracket at the start
			// This happens when VS Code's bracket completion runs before our suggestion
			const suffixFirstChar = suffix.length > 0 ? suffix[0] : ""
			const originalSuffixFirstChar =
				matchingResult.originalSuggestion.suffix.length > 0 ? matchingResult.originalSuggestion.suffix[0] : ""

			// Detect if a bracket was auto-inserted:
			// 1. Current suffix starts with an auto-closing character
			// 2. Original suffix didn't start with that character (or was different)
			const hasAutoInsertedBracket =
				isAutoClosingChar(suffixFirstChar) && suffixFirstChar !== originalSuffixFirstChar

			const item: vscode.InlineCompletionItem = {
				insertText: matchingResult.text,
				range: hasAutoInsertedBracket
					? new vscode.Range(position, new vscode.Position(position.line, position.character + 1)) // Replace the auto-bracket
					: new vscode.Range(position, position), // Just insert
				command: {
					title: "Accept Suggestion",
					command: "editor.action.inlineSuggest.commit",
				},
			}
			return [item]
		}

		// Check if auto-trigger is enabled
		// Only proceed with LLM call if:
		// 1. It's a manual trigger (triggerKind === Invoke), OR
		// 2. Auto-trigger is enabled (enableAutoTrigger === true)
		const isManualTrigger = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
		const isAutoTriggerEnabled = this.settings?.enableAutoTrigger ?? false

		if (!isManualTrigger && !isAutoTriggerEnabled) {
			// Auto-trigger is disabled and this is not a manual trigger
			return []
		}

		// No cached suggestion available - invoke LLM
		if (this.model && this.ghostContext) {
			// Show cursor animation while generating
			this.cursorAnimation.active()

			const context: GhostSuggestionContext = {
				document,
				range: new vscode.Range(position, position),
			}

			const fullContext = await this.ghostContext.generate(context)
			const result = await this.getFromLLM(fullContext, this.model)

			// Hide cursor animation after generation
			this.cursorAnimation.hide()

			// Track costs
			if (this.costTrackingCallback) {
				this.costTrackingCallback(
					result.cost,
					result.inputTokens,
					result.outputTokens,
					result.cacheWriteTokens,
					result.cacheReadTokens,
				)
			}

			// Update suggestions history
			this.updateSuggestions(result.suggestions)

			// Return the new suggestion if available
			const fillInAtCursor = result.suggestions.getFillInAtCursor()
			if (fillInAtCursor) {
				const item: vscode.InlineCompletionItem = {
					insertText: fillInAtCursor.text,
					range: new vscode.Range(position, position),
					command: {
						title: "Accept Suggestion",
						command: "editor.action.inlineSuggest.commit",
					},
				}
				return [item]
			}
		}

		return []
	}
}
