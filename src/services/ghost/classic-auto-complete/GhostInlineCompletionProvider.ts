import * as vscode from "vscode"
import { extractPrefixSuffix, GhostSuggestionContext, contextToAutocompleteInput, AutocompleteInput } from "../types"
import { GhostContextProvider } from "./GhostContextProvider"
import { parseGhostResponse, HoleFiller, FillInAtCursorSuggestion } from "./HoleFiller"
import { GhostModel } from "../GhostModel"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { RecentlyVisitedRangesService } from "../../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService"
import { RecentlyEditedTracker } from "../../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited"
import type { GhostServiceSettings } from "@roo-code/types"
import { postprocessGhostSuggestion } from "./uselessSuggestionFilter"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { getTemplateForModel } from "../../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { SuggestionAdjuster } from "./SuggestionAdjuster"

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
	autocompleteInput: AutocompleteInput
}

/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion text, or null if no match found
 * @deprecated Use SuggestionAdjuster.findInHistory instead
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): string | null {
	return SuggestionAdjuster.findInHistory(prefix, suffix, suggestionsHistory)
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

interface PendingSuggestion {
	prefix: string
	suffix: string
	promise: Promise<LLMRetrievalResult>
	abortController: AbortController
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []
	private holeFiller: HoleFiller
	private contextProvider: GhostContextProvider
	private model: GhostModel
	private costTrackingCallback: CostTrackingCallback
	private getSettings: () => GhostServiceSettings | null
	private recentlyVisitedRangesService: RecentlyVisitedRangesService
	private recentlyEditedTracker: RecentlyEditedTracker
	private debounceTimer: NodeJS.Timeout | null = null
	private ignoreController?: Promise<RooIgnoreController>
	private pendingRequests: Map<string, PendingSuggestion> = new Map()

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
		this.contextProvider = contextProvider
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

		return { systemPrompt, userPrompt, prefix, suffix, autocompleteInput }
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

	public async getFromLLM(prompt: GhostPrompt, model: GhostModel): Promise<LLMRetrievalResult> {
		const { systemPrompt, userPrompt, prefix, suffix, autocompleteInput } = prompt

		if (model.supportsFim()) {
			return this.getFromFIM(prefix, suffix, model, autocompleteInput)
		}

		let response = ""

		const onChunk = (chunk: ApiStreamChunk) => {
			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		console.log("[HoleFiller] userPrompt:", userPrompt)

		const usageInfo = await model.generateResponse(systemPrompt, userPrompt, onChunk)

		console.log("response", response)

		const parsedSuggestion = parseGhostResponse(response, prefix, suffix)
		const fillInAtCursorSuggestion = this.processSuggestion(parsedSuggestion.text, prefix, suffix, model)

		if (fillInAtCursorSuggestion.text) {
			console.info("Final suggestion:", fillInAtCursorSuggestion)
		}

		return {
			suggestion: fillInAtCursorSuggestion,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
		}
	}

	private async getFromFIM(
		prefix: string,
		suffix: string,
		model: GhostModel,
		autocompleteInput: AutocompleteInput,
	): Promise<LLMRetrievalResult> {
		let perflog = ""
		const logtime = (() => {
			let timestamp = performance.now()
			return (msg: string) => {
				const baseline = timestamp
				timestamp = performance.now()
				perflog += `${msg}: ${timestamp - baseline}\n`
			}
		})()

		const { filepathUri, helper, snippetsWithUris, workspaceDirs } =
			await this.contextProvider.getProcessedSnippets(autocompleteInput, autocompleteInput.filepath)
		logtime("snippets")

		// Use pruned prefix/suffix from HelperVars (token-limited based on DEFAULT_AUTOCOMPLETE_OPTS)
		const prunedPrefix = helper.prunedPrefix
		const prunedSuffix = helper.prunedSuffix

		const modelName = model.getModelName() ?? "codestral"
		const template = getTemplateForModel(modelName)

		let formattedPrefix = prunedPrefix
		if (template.compilePrefixSuffix) {
			const [compiledPrefix] = template.compilePrefixSuffix(
				prunedPrefix,
				prunedSuffix,
				filepathUri,
				"", // reponame not used in our context
				snippetsWithUris,
				workspaceDirs,
			)
			formattedPrefix = compiledPrefix
		}

		console.log("[FIM] formattedPrefix:", formattedPrefix)

		let response = ""
		const onChunk = (text: string) => {
			response += text
		}
		logtime("prep fim")
		const usageInfo = await model.generateFimResponse(
			formattedPrefix,
			prunedSuffix,
			onChunk,
			autocompleteInput.completionId, // Pass completionId as taskId for tracking
		)
		logtime("fim network")
		console.log("[FIM] response:", response)

		const fillInAtCursorSuggestion = this.processSuggestion(response, prefix, suffix, model)

		if (fillInAtCursorSuggestion.text) {
			console.info("Final FIM suggestion:", fillInAtCursorSuggestion)
		}
		logtime("processSuggestion")
		console.log(perflog + `lengths: ${formattedPrefix.length + prunedSuffix.length}\n`)
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
		// Clear pending debounce resolvers
		this.pendingDebounceResolvers = []
		// Cancel all pending requests
		for (const pending of this.pendingRequests.values()) {
			pending.abortController.abort()
		}
		this.pendingRequests.clear()
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

	private pendingDebounceResolvers: Array<() => void> = []
	private lastDebouncedPrompt: GhostPrompt | null = null

	private debouncedFetchAndCacheSuggestion(prompt: GhostPrompt): Promise<void> {
		// Check if we have a pending request with a different prefix/suffix
		if (this.debounceTimer !== null && this.lastDebouncedPrompt) {
			const lastPrompt = this.lastDebouncedPrompt

			// Check if this is a "typing ahead" scenario (new prefix starts with old prefix and same suffix)
			const isTypingAhead = prompt.prefix.startsWith(lastPrompt.prefix) && prompt.suffix === lastPrompt.suffix

			// Check if prefix has truly diverged (not just typing ahead)
			const hasDiverged =
				!isTypingAhead && (lastPrompt.prefix !== prompt.prefix || lastPrompt.suffix !== prompt.suffix)

			if (hasDiverged) {
				// Prefix/suffix has diverged - flush the pending request immediately
				clearTimeout(this.debounceTimer)
				this.debounceTimer = null

				// Trigger the previous request
				const previousResolvers = this.pendingDebounceResolvers.splice(0)
				this.fetchAndCacheSuggestion(lastPrompt).then(() => {
					previousResolvers.forEach((r) => r())
				})
			} else {
				// Same prefix/suffix or typing ahead - just clear the timer to restart debounce
				clearTimeout(this.debounceTimer)
			}
		}

		// Store the current prompt
		this.lastDebouncedPrompt = prompt

		return new Promise<void>((resolve) => {
			// Add this resolver to the list
			this.pendingDebounceResolvers.push(resolve)

			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				// Use the last prompt that was set
				if (this.lastDebouncedPrompt) {
					await this.fetchAndCacheSuggestion(this.lastDebouncedPrompt)
					this.lastDebouncedPrompt = null
				}

				// Resolve all pending promises
				const resolvers = this.pendingDebounceResolvers.splice(0)
				resolvers.forEach((r) => r())
			}, DEBOUNCE_DELAY_MS)
		})
	}

	/**
	 * Create a cache key for request deduplication
	 */
	private getCacheKey(prefix: string, suffix: string): string {
		return `${prefix}|||${suffix}`
	}

	/**
	 * Check if we can reuse a pending request for the current prefix/suffix
	 */
	private findReusablePendingRequest(prefix: string, suffix: string): PendingSuggestion | null {
		const cacheKey = this.getCacheKey(prefix, suffix)

		// Check for exact match first
		const exactMatch = this.pendingRequests.get(cacheKey)
		if (exactMatch) {
			return exactMatch
		}

		// Check if we can reuse a request with a shorter prefix (user typed ahead)
		for (const [key, pending] of this.pendingRequests.entries()) {
			if (pending.suffix === suffix && prefix.startsWith(pending.prefix)) {
				// User has typed ahead - we can potentially reuse this request
				return pending
			}
		}

		return null
	}

	private async fetchAndCacheSuggestion(prompt: GhostPrompt): Promise<void> {
		const { prefix, suffix } = prompt
		const cacheKey = this.getCacheKey(prefix, suffix)

		// Check if we can reuse an existing pending request
		const reusable = this.findReusablePendingRequest(prefix, suffix)
		if (reusable) {
			try {
				// Wait for the existing request to complete
				const result = await reusable.promise

				// Check if request was aborted while waiting
				if (reusable.abortController.signal.aborted) {
					return
				}

				// Adjust the suggestion if user typed ahead
				const adjustedSuggestion = SuggestionAdjuster.adjustSuggestion(result.suggestion, prefix, suffix)
				if (adjustedSuggestion) {
					this.updateSuggestions(adjustedSuggestion)
					return
				}

				// Use the result as-is if no adjustment needed (exact match case)
				if (prefix === reusable.prefix && suffix === reusable.suffix) {
					this.updateSuggestions(result.suggestion)
					return
				}
			} catch (error) {
				// If reused request failed or was aborted, fall through to create new request
				if (error instanceof Error && error.name === "AbortError") {
					return
				}
				console.warn("Reused request failed, creating new request:", error)
			}
		}

		// Cancel any pending requests that are now obsolete
		for (const [key, pending] of this.pendingRequests.entries()) {
			// Cancel if different suffix or if prefix has diverged
			if (
				pending.suffix !== suffix ||
				(!prefix.startsWith(pending.prefix) && !pending.prefix.startsWith(prefix))
			) {
				pending.abortController.abort()
				this.pendingRequests.delete(key)
			}
		}

		// Create new request with abort controller
		const abortController = new AbortController()

		const promise = (async (): Promise<LLMRetrievalResult> => {
			try {
				// Check if already aborted before starting
				if (abortController.signal.aborted) {
					throw new Error("Request aborted before starting")
				}

				const result = await this.getFromLLM(prompt, this.model)

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
				this.pendingRequests.delete(cacheKey)
			}
		})()

		// Store the pending request
		this.pendingRequests.set(cacheKey, {
			prefix,
			suffix,
			promise,
			abortController,
		})

		try {
			await promise
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				// Silently ignore aborted requests
				return
			}
			console.error("Error getting inline completion from LLM:", error)
		}
	}
}
