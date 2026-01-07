import * as vscode from "vscode"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { AutocompleteContext, VisibleCodeContext } from "../types"
import { removePrefixOverlap } from "../../continuedev/core/autocomplete/postprocessing/removePrefixOverlap.js"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"
import { postprocessGhostSuggestion } from "../classic-auto-complete/uselessSuggestionFilter"
import {
	parseCompletionTags,
	getHoleFillerSystemPrompt,
	buildHoleFillerUserPrompt,
} from "../classic-auto-complete/HoleFiller"

export class ChatTextAreaAutocomplete {
	private model: GhostModel
	private providerSettingsManager: ProviderSettingsManager
	private telemetry: AutocompleteTelemetry

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.model = new GhostModel()
		this.providerSettingsManager = providerSettingsManager
		this.telemetry = new AutocompleteTelemetry("chat-textarea")
	}

	async initialize(): Promise<boolean> {
		return this.model.reload(this.providerSettingsManager)
	}

	async getCompletion(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<{ suggestion: string }> {
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

		let usedChatCompletion = false

		try {
			// Use FIM if supported, otherwise fall back to chat-based completion
			if (this.model.supportsFim()) {
				await this.model.generateFimResponse(prefix, suffix, (chunk) => {
					response += chunk
				})
			} else {
				// Fall back to chat-based completion for models without FIM support
				usedChatCompletion = true
				const systemPrompt = getHoleFillerSystemPrompt()
				const userPrompt = buildHoleFillerUserPrompt(prefix, "", "chat")

				await this.model.generateResponse(systemPrompt, userPrompt, (chunk) => {
					if (chunk.type === "text") {
						response += chunk.text
					}
				})
			}

			const latencyMs = Date.now() - startTime

			// Capture successful LLM request
			this.telemetry.captureLlmRequestCompleted(
				{
					latencyMs,
					// Token counts not available from current API
				},
				context,
			)

			// Parse COMPLETION tags if we used chat-based completion (using shared parser from HoleFiller)
			if (usedChatCompletion) {
				response = parseCompletionTags(response)
			}

			const cleanedSuggestion = this.cleanSuggestion(response, userText)

			// Track if suggestion was filtered or returned
			if (!cleanedSuggestion) {
				if (!response.trim()) {
					this.telemetry.captureSuggestionFiltered("empty_response", context)
				} else {
					this.telemetry.captureSuggestionFiltered("filtered_by_postprocessing", context)
				}
			} else {
				this.telemetry.captureLlmSuggestionReturned(context, cleanedSuggestion.length)
			}

			return { suggestion: cleanedSuggestion }
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
