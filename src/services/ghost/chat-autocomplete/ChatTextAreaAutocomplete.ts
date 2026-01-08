import * as vscode from "vscode"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import {
	AutocompleteContext,
	VisibleCodeContext,
	AutocompleteInput,
	GhostContextProvider,
	FillInAtCursorSuggestion,
} from "../types"
import { removePrefixOverlap } from "../../continuedev/core/autocomplete/postprocessing/removePrefixOverlap.js"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"
import { postprocessGhostSuggestion } from "../classic-auto-complete/uselessSuggestionFilter"
import { HoleFiller } from "../classic-auto-complete/HoleFiller"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"

export class ChatTextAreaAutocomplete {
	private model: GhostModel
	private providerSettingsManager: ProviderSettingsManager
	private telemetry: AutocompleteTelemetry
	private holeFiller: HoleFiller | null = null
	private ide: VsCodeIde | null = null

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.model = new GhostModel()
		this.providerSettingsManager = providerSettingsManager
		this.telemetry = new AutocompleteTelemetry("chat-textarea")
	}

	async initialize(): Promise<boolean> {
		return this.model.reload(this.providerSettingsManager)
	}

	/**
	 * Initialize the HoleFiller with context provider (lazy initialization)
	 */
	private initializeHoleFiller(context: vscode.ExtensionContext): void {
		if (this.holeFiller) {
			return
		}

		this.ide = new VsCodeIde(context)
		const contextService = new ContextRetrievalService(this.ide)
		const contextProvider: GhostContextProvider = {
			ide: this.ide,
			contextService,
			model: this.model,
			// No ignoreController for chat - we don't need file filtering
		}
		this.holeFiller = new HoleFiller(contextProvider)
	}

	async getCompletion(
		userText: string,
		visibleCodeContext?: VisibleCodeContext,
		extensionContext?: vscode.ExtensionContext,
	): Promise<{ suggestion: string }> {
		const startTime = Date.now()

		// Build context for telemetry
		const context: AutocompleteContext = {
			languageId: "chat", // Chat textarea doesn't have a language ID
			modelId: this.model.getModelName(),
			provider: this.model.getProviderDisplayName(),
		}

		if (!this.model.loaded) {
			const loaded = await this.initialize()
			if (!loaded) {
				return { suggestion: "" }
			}
		}

		// Check if model has valid credentials (but don't require FIM)
		if (!this.model.hasValidCredentials()) {
			return { suggestion: "" }
		}

		// Capture suggestion requested
		this.telemetry.captureSuggestionRequested(context)

		const prefix = await this.buildPrefix(userText, visibleCodeContext)
		const suffix = ""

		let response = ""

		try {
			// Use FIM if supported, otherwise fall back to chat-based completion via HoleFiller
			if (this.model.supportsFim()) {
				await this.model.generateFimResponse(prefix, suffix, (chunk) => {
					response += chunk
				})

				const latencyMs = Date.now() - startTime
				this.telemetry.captureLlmRequestCompleted({ latencyMs }, context)

				const cleanedSuggestion = this.cleanSuggestion(response, userText)
				this.trackSuggestionResult(cleanedSuggestion, response, context)
				return { suggestion: cleanedSuggestion }
			} else {
				// Fall back to chat-based completion using HoleFiller
				// Initialize HoleFiller if not already set (tests may inject it directly)
				if (!this.holeFiller) {
					if (!extensionContext) {
						// Can't initialize HoleFiller without extension context
						return { suggestion: "" }
					}
					this.initializeHoleFiller(extensionContext)
				}

				if (!this.holeFiller) {
					return { suggestion: "" }
				}

				// Create AutocompleteInput for HoleFiller
				const autocompleteInput = this.createAutocompleteInput(prefix)

				// Get prompts from HoleFiller
				const prompt = await this.holeFiller.getPrompts(autocompleteInput, "chat")

				// Process suggestion callback
				const processSuggestion = (text: string): FillInAtCursorSuggestion => {
					return { text, prefix, suffix }
				}

				// Get completion from HoleFiller
				const result = await this.holeFiller.getFromChat(this.model, prompt, processSuggestion)

				const latencyMs = Date.now() - startTime
				this.telemetry.captureLlmRequestCompleted(
					{
						latencyMs,
						cost: result.cost,
						inputTokens: result.inputTokens,
						outputTokens: result.outputTokens,
					},
					context,
				)

				const cleanedSuggestion = this.cleanSuggestion(result.suggestion.text, userText)
				this.trackSuggestionResult(cleanedSuggestion, result.suggestion.text, context)
				return { suggestion: cleanedSuggestion }
			}
		} catch (error) {
			const latencyMs = Date.now() - startTime
			this.telemetry.captureLlmRequestFailed(
				{
					latencyMs,
					error: error instanceof Error ? error.message : String(error),
				},
				context,
			)
			return { suggestion: "" }
		}
	}

	/**
	 * Create an AutocompleteInput for HoleFiller from the chat prefix
	 */
	private createAutocompleteInput(prefix: string): AutocompleteInput {
		return {
			isUntitledFile: true, // Chat is not a file
			completionId: crypto.randomUUID(),
			filepath: "chat-textarea", // Virtual path for chat
			pos: { line: 0, character: prefix.length },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
			manuallyPassFileContents: prefix,
			manuallyPassPrefix: prefix,
		}
	}

	/**
	 * Track suggestion result for telemetry
	 */
	private trackSuggestionResult(cleanedSuggestion: string, rawResponse: string, context: AutocompleteContext): void {
		if (!cleanedSuggestion) {
			if (!rawResponse.trim()) {
				this.telemetry.captureSuggestionFiltered("empty_response", context)
			} else {
				this.telemetry.captureSuggestionFiltered("filtered_by_postprocessing", context)
			}
		} else {
			this.telemetry.captureLlmSuggestionReturned(context, cleanedSuggestion.length)
		}
	}

	private async buildPrefix(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<string> {
		const contextParts: string[] = []

		// Add visible code context (replaces cursor-based prefix/suffix)
		if (visibleCodeContext && visibleCodeContext.editors.length > 0) {
			contextParts.push("// Code visible in editor:")

			for (const editor of visibleCodeContext.editors) {
				const fileName = editor.filePath.split("/").pop() || editor.filePath
				contextParts.push(`\n// File: ${fileName} (${editor.languageId})`)

				for (const range of editor.visibleRanges) {
					contextParts.push(range.content)
				}
			}
		}

		const clipboardContent = await this.getClipboardContext()
		if (clipboardContent) {
			contextParts.push("\n// Clipboard content:")
			contextParts.push(clipboardContent)
		}

		contextParts.push("\n// User's message:")
		contextParts.push(userText)

		return contextParts.join("\n")
	}

	private async getClipboardContext(): Promise<string | null> {
		try {
			const text = await vscode.env.clipboard.readText()
			// Only include if it's reasonable size and looks like code
			if (text && text.length > 5 && text.length < 500) {
				return text
			}
		} catch {
			// Silently ignore clipboard errors
		}
		return null
	}

	public cleanSuggestion(suggestion: string, userText: string): string {
		let cleaned = postprocessGhostSuggestion({
			suggestion: removePrefixOverlap(suggestion, userText),
			prefix: userText,
			suffix: "", // Chat textarea has no suffix
			model: this.model.getModelName() ?? "unknown",
		})

		if (cleaned === undefined) {
			return ""
		}

		// Filter suggestions that look like code rather than natural language
		if (cleaned.match(/^(\/\/|\/\*|\*|#)/)) {
			return ""
		}

		// Chat-specific: truncate at first newline for single-line suggestions
		const firstNewline = cleaned.indexOf("\n")
		if (firstNewline !== -1) {
			cleaned = cleaned.substring(0, firstNewline)
		}
		cleaned = cleaned.trimEnd()

		return cleaned
	}
}
