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
import { ApiStreamChunk } from "../../../api/transform/stream"
import { GeneratorReuseManager } from "../../continuedev/core/autocomplete/generation/GeneratorReuseManager"
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

type PendingSuggestionState = {
	requestId: number
	documentUri: string
	prefix: string
	suffix: string
	usagePromise: Promise<{
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}> | null
	done: Promise<void>
	resolveDone: () => void
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []

	/**
	 * Pending (in-flight) suggestion state.
	 *
	 * We keep this separate from `suggestionsHistory` to avoid polluting the history with many
	 * partial entries. The pending suggestion is treated as the "most recent" entry for matching.
	 */
	private pendingSuggestion: PendingSuggestionState | null = null
	private pendingRequestId = 0

	private generatorReuseManager = new GeneratorReuseManager((err) => {
		console.error("[GhostInlineCompletionProvider] GeneratorReuseManager error:", err)
	})

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

		this.generatorReuseManager.currentGenerator?.cancel()
		this.pendingSuggestion = null

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
			const documentUri = document.uri.toString()

			const matchingText = this.findMatchingSuggestionIncludingPending(prefix, suffix, documentUri)

			if (matchingText !== null) {
				return stringToInlineCompletions(matchingText, position)
			}

			const { prompt, prefix: promptPrefix, suffix: promptSuffix } = await this.getPrompt(document, position)

			// Start streaming in background (debounced), potentially reusing an in-flight request.
			await this.debouncedStartOrReuseStreaming(prompt, promptPrefix, promptSuffix, documentUri)

			const cachedText = this.findMatchingSuggestionIncludingPending(prefix, suffix, documentUri)
			return stringToInlineCompletions(cachedText ?? "", position)
		} catch (error) {
			// only big catch at the top of the call-chain, if anything goes wrong at a lower level
			// do not catch, just let the error cascade
			console.error("[GhostInlineCompletionProvider] Error providing inline completion:", error)
			return []
		}
	}

	private findMatchingSuggestionIncludingPending(prefix: string, suffix: string, documentUri: string): string | null {
		const candidates: FillInAtCursorSuggestion[] = [...this.suggestionsHistory]

		// Pending suggestion should be preferred over history, so we append it last.
		if (
			this.pendingSuggestion &&
			this.pendingSuggestion.documentUri === documentUri &&
			this.pendingSuggestion.suffix === suffix
		) {
			const pendingPrefix = this.pendingSuggestion.prefix
			const pendingRawText = this.generatorReuseManager.pendingCompletion

			const processedPending = this.processSuggestion(pendingRawText, pendingPrefix, suffix, this.model)
			candidates.push(processedPending)
		}

		return findMatchingSuggestion(prefix, suffix, candidates)
	}

	private createCompletionTagDeltaParser() {
		const openTag = "<completion>"
		const closeTag = "</completion>"
		const keepOpen = openTag.length - 1
		const keepClose = closeTag.length - 1

		let buffer = ""
		let inCompletion = false
		let done = false

		return {
			push(text: string): string {
				if (done) return ""

				buffer += text
				let output = ""

				while (buffer.length > 0 && !done) {
					const lower = buffer.toLowerCase()

					if (!inCompletion) {
						const openIndex = lower.indexOf(openTag)
						if (openIndex < 0) {
							// Keep a small tail so tags split across chunks still match.
							buffer = buffer.slice(Math.max(0, buffer.length - keepOpen))
							break
						}

						// Discard everything up to (and including) the opening tag.
						buffer = buffer.slice(openIndex + openTag.length)
						inCompletion = true
						continue
					}

					const closeIndex = lower.indexOf(closeTag)
					if (closeIndex < 0) {
						/**
						 * No close tag found yet.
						 *
						 * To support streaming, we want to emit as much as we safely can, but still keep
						 * the possibility of a `</COMPLETION>` tag being split across chunk boundaries.
						 *
						 * Keeping a fixed tail (`keepClose`) is overly conservative and can truncate real
						 * completion text (e.g. when the chunk contains only content and no `<`).
						 *
						 * Safer heuristic:
						 * - If there is no `<` at all, we can emit the entire buffer.
						 * - If there is a `<`, keep from the last `<` onwards (it might be the start of `</COMPLETION>`).
						 */
						const lastLt = buffer.lastIndexOf("<")
						if (lastLt < 0) {
							output += buffer
							buffer = ""
							break
						}

						// Emit everything before the last potential tag fragment.
						output += buffer.slice(0, lastLt)
						buffer = buffer.slice(lastLt)

						// If what's left is longer than our conservative tail, trim it down.
						if (buffer.length > keepClose) {
							output += buffer.slice(0, buffer.length - keepClose)
							buffer = buffer.slice(buffer.length - keepClose)
						}

						break
					}

					// Emit up to close tag, then mark done.
					output += buffer.slice(0, closeIndex)
					buffer = ""
					done = true
				}

				return output
			},
		}
	}

	private createAsyncQueue<T>() {
		const values: T[] = []
		const waiters: Array<(value: IteratorResult<T>) => void> = []
		let ended = false

		return {
			push(value: T) {
				if (ended) return
				const waiter = waiters.shift()
				if (waiter) {
					waiter({ value, done: false })
				} else {
					values.push(value)
				}
			},
			end() {
				if (ended) return
				ended = true
				while (waiters.length) {
					const waiter = waiters.shift()!
					waiter({ value: undefined as any, done: true })
				}
			},
			async *iterate(): AsyncGenerator<T> {
				while (true) {
					if (values.length) {
						yield values.shift()!
						continue
					}
					if (ended) {
						return
					}
					const next = await new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
					if (next.done) {
						return
					}
					yield next.value
				}
			},
		}
	}

	private createSuggestionGeneratorAndUsagePromise(
		prompt: GhostPrompt,
		abortSignal: AbortSignal,
	): {
		generator: AsyncGenerator<string>
		usagePromise: Promise<{
			cost: number
			inputTokens: number
			outputTokens: number
			cacheWriteTokens: number
			cacheReadTokens: number
		}>
	} {
		const queue = this.createAsyncQueue<string>()

		let usageResolve!: (usage: {
			cost: number
			inputTokens: number
			outputTokens: number
			cacheWriteTokens: number
			cacheReadTokens: number
		}) => void
		let usageReject!: (err: unknown) => void
		const usagePromise = new Promise<{
			cost: number
			inputTokens: number
			outputTokens: number
			cacheWriteTokens: number
			cacheReadTokens: number
		}>((resolve, reject) => {
			usageResolve = resolve
			usageReject = reject
		})

		const model = this.model
		const createCompletionTagDeltaParser = () => this.createCompletionTagDeltaParser()

		const generator = (async function* () {
			// Run the underlying model request concurrently; it will push into our queue via callbacks.
			;(async () => {
				try {
					if (prompt.strategy === "fim") {
						const usage = await model.generateFimResponse(
							prompt.formattedPrefix,
							prompt.prunedSuffix,
							(text: string) => {
								if (!abortSignal.aborted && text) {
									queue.push(text)
								}
							},
							prompt.autocompleteInput.completionId,
						)
						usageResolve(usage)
					} else {
						const parser = createCompletionTagDeltaParser()

						const usage = await model.generateResponse(
							prompt.systemPrompt,
							prompt.userPrompt,
							(chunk: ApiStreamChunk) => {
								if (abortSignal.aborted) return
								if (chunk.type !== "text") return
								const delta = parser.push(chunk.text ?? "")
								if (delta) {
									queue.push(delta)
								}
							},
						)
						usageResolve(usage)
					}
				} catch (err) {
					usageReject(err)
				} finally {
					queue.end()
				}
			})().catch(() => {
				// Prevent unhandled rejection; errors are surfaced through usagePromise.
			})

			for await (const chunk of queue.iterate()) {
				if (abortSignal.aborted) {
					return
				}
				yield chunk
			}
		})()

		return { generator, usagePromise }
	}

	private cancelActiveGeneration() {
		this.generatorReuseManager.currentGenerator?.cancel()
		this.generatorReuseManager.currentGenerator = undefined
		this.generatorReuseManager.pendingGeneratorPrefix = undefined
		this.generatorReuseManager.pendingCompletion = ""
		this.pendingSuggestion = null
	}

	private debouncedStartOrReuseStreaming(
		prompt: GhostPrompt,
		prefix: string,
		suffix: string,
		documentUri: string,
	): Promise<void> {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		return new Promise<void>((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				await this.startOrReuseStreaming(prompt, prefix, suffix, documentUri)

				/**
				 * Give the newly-started streaming pipeline a chance to run a microtask turn so that
				 * synchronous stream mocks (tests) and fast providers can populate `pendingCompletion`
				 * before the provider call reads it again.
				 */
				await new Promise<void>((r) => queueMicrotask(r))

				resolve()
			}, DEBOUNCE_DELAY_MS)
		})
	}

	private async startOrReuseStreaming(prompt: GhostPrompt, prefix: string, suffix: string, documentUri: string) {
		// If the context changed (suffix/doc), cancel previous generation, regardless of prefix reuse.
		if (
			this.pendingSuggestion &&
			(this.pendingSuggestion.documentUri !== documentUri || this.pendingSuggestion.suffix !== suffix)
		) {
			this.cancelActiveGeneration()
		}

		const requestId = ++this.pendingRequestId

		let usagePromiseFromNewGenerator:
			| Promise<{
					cost: number
					inputTokens: number
					outputTokens: number
					cacheWriteTokens: number
					cacheReadTokens: number
			  }>
			| undefined

		const reused = this.generatorReuseManager.ensureGenerator(prefix, (abortSignal) => {
			const { generator, usagePromise } = this.createSuggestionGeneratorAndUsagePromise(prompt, abortSignal)
			usagePromiseFromNewGenerator = usagePromise
			return generator
		})

		if (reused) {
			// Reuse means the pendingSuggestion remains valid; no new finalizer should be started.
			return
		}

		// New generation: establish pending state.
		let resolveDone!: () => void
		const done = new Promise<void>((resolve) => {
			resolveDone = resolve
		})

		this.pendingSuggestion = {
			requestId,
			documentUri,
			prefix,
			suffix,
			usagePromise: usagePromiseFromNewGenerator ?? null,
			done,
			resolveDone,
		}

		// Finalize suggestion + cost accounting once the underlying generator finishes.
		const currentGenerator = this.generatorReuseManager.currentGenerator
		const completionPrefix = this.generatorReuseManager.pendingGeneratorPrefix ?? prefix
		const usagePromise = usagePromiseFromNewGenerator

		if (!currentGenerator || !usagePromise) {
			// Nothing to finalize.
			this.pendingSuggestion.resolveDone()
			return
		}

		currentGenerator
			.waitForCompletion()
			.then(async () => {
				// Ignore if a newer request has superseded this one.
				if (!this.pendingSuggestion || this.pendingSuggestion.requestId !== requestId) {
					return
				}

				let usage
				try {
					usage = await usagePromise
				} catch (err) {
					console.error("[GhostInlineCompletionProvider] Error in streaming usage promise:", err)
					return
				}

				const finalTextRaw = this.generatorReuseManager.pendingCompletion
				const finalSuggestion = this.processSuggestion(finalTextRaw, completionPrefix, suffix, this.model)

        this.costTrackingCallback(
          usage.cost,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheWriteTokens,
          usage.cacheReadTokens,
        )

				// Always cache, even if empty (failed/filtered suggestion).
				this.updateSuggestions(finalSuggestion)
			})
			.catch((err) => {
				console.error("[GhostInlineCompletionProvider] Error waiting for generator completion:", err)
			})
			.finally(() => {
				// Resolve the pending promise and clear pending state if it's still ours.
				if (this.pendingSuggestion?.requestId === requestId) {
					this.pendingSuggestion.resolveDone()
					this.pendingSuggestion = null
				}
			})
	}
}
