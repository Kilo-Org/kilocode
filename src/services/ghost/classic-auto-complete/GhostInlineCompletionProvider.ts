import * as vscode from "vscode"
import { FillInAtCursorSuggestion, GhostSuggestionsState } from "./GhostSuggestions"
import { extractPrefixSuffix, GhostSuggestionContext, contextToAutocompleteInput } from "../types"
import { parseGhostResponse } from "./GhostStreamingParser"
import { AutoTriggerStrategy } from "./AutoTriggerStrategy"
import { GhostModel } from "../GhostModel"
import { GhostContext } from "../GhostContext"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { GhostGutterAnimation } from "../GhostGutterAnimation"

const MAX_SUGGESTIONS_HISTORY = 20

/**
 * Bracket pairs that VSCode auto-closes
 */
const BRACKET_PAIRS: Record<string, string> = {
	"[": "]",
	"(": ")",
	"{": "}",
	"<": ">",
	'"': '"',
	"'": "'",
	"`": "`",
}

/**
 * Detect if the suggestion text contains closing brackets that might have been auto-closed by VSCode
 * @param suggestionText - The text being suggested
 * @returns Array of closing bracket characters found in the suggestion
 */
export function findClosingBracketsInSuggestion(suggestionText: string): string[] {
	const closingBrackets: string[] = []
	const closingChars = new Set(Object.values(BRACKET_PAIRS))

	for (const char of suggestionText) {
		if (closingChars.has(char)) {
			closingBrackets.push(char)
		}
	}

	return closingBrackets
}

/**
 * Calculate how many auto-closed characters after the cursor should be replaced
 * @param document - The text document
 * @param position - Current cursor position
 * @param suggestionText - The text being suggested
 * @returns Number of characters after cursor to include in replacement range
 */
export function calculateAutoClosedCharsToReplace(
	document: vscode.TextDocument,
	position: vscode.Position,
	suggestionText: string,
): number {
	// Get text after cursor on the same line
	const lineText = document.lineAt(position.line).text
	const textAfterCursor = lineText.substring(position.character)

	// If there's nothing after cursor, no auto-closed chars to replace
	if (!textAfterCursor) {
		return 0
	}

	// Find closing brackets in the suggestion
	const closingBracketsInSuggestion = findClosingBracketsInSuggestion(suggestionText)

	if (closingBracketsInSuggestion.length === 0) {
		return 0
	}

	// Check how many consecutive characters after cursor match closing brackets in suggestion
	let charsToReplace = 0
	let suggestionBracketIndex = 0

	for (let i = 0; i < textAfterCursor.length && suggestionBracketIndex < closingBracketsInSuggestion.length; i++) {
		const charAfterCursor = textAfterCursor[i]

		// Skip whitespace
		if (charAfterCursor === " " || charAfterCursor === "\t") {
			continue
		}

		// Check if this character matches the next closing bracket in our suggestion
		if (charAfterCursor === closingBracketsInSuggestion[suggestionBracketIndex]) {
			charsToReplace = i + 1
			suggestionBracketIndex++
		} else {
			// If we hit a non-matching character, stop
			break
		}
	}

	return charsToReplace
}

export type CostTrackingCallback = (
	cost: number,
	inputTokens: number,
	outputTokens: number,
	cacheWriteTokens: number,
	cacheReadTokens: number,
) => void

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

		// If no exact match, check for partial typing
		// The user may have started typing the suggested text
		if (prefix.startsWith(fillInAtCursor.prefix) && suffix === fillInAtCursor.suffix) {
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
		_context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		const { prefix, suffix } = extractPrefixSuffix(document, position)

		const matchingText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

		if (matchingText !== null) {
			// Calculate how many auto-closed characters to replace
			const charsToReplace = calculateAutoClosedCharsToReplace(document, position, matchingText)
			const endPosition = new vscode.Position(position.line, position.character + charsToReplace)

			const item: vscode.InlineCompletionItem = {
				insertText: matchingText,
				range: new vscode.Range(position, endPosition),
			}
			return [item]
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
				// Calculate how many auto-closed characters to replace
				const charsToReplace = calculateAutoClosedCharsToReplace(document, position, fillInAtCursor.text)
				const endPosition = new vscode.Position(position.line, position.character + charsToReplace)

				const item: vscode.InlineCompletionItem = {
					insertText: fillInAtCursor.text,
					range: new vscode.Range(position, endPosition),
				}
				return [item]
			}
		}

		return []
	}
}
