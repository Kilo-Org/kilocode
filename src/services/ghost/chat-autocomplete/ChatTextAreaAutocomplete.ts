import * as vscode from "vscode"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { AutocompleteContext, VisibleCodeContext } from "../types"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { removePrefixOverlap } from "../../continuedev/core/autocomplete/postprocessing/removePrefixOverlap.js"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"

/**
 * Service for providing FIM-based autocomplete suggestions in ChatTextArea
 */
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

	/**
	 * Check if we can successfully make a FIM request.
	 * Validates that model is loaded, has valid API handler, and supports FIM.
	 */
	isFimAvailable(): boolean {
		return this.model.hasValidCredentials() && this.model.supportsFim()
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

		try {
			// Use FIM if supported, otherwise fall back to chat-based completion
			if (this.model.supportsFim()) {
				await this.model.generateFimResponse(prefix, suffix, (chunk) => {
					response += chunk
				})
			} else {
				// Fall back to chat-based completion for models without FIM support
				const systemPrompt = this.getChatSystemPrompt()
				const userPrompt = this.getChatUserPrompt(prefix)

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

	/**
	 * Get system prompt for chat-based completion
	 */
	private getChatSystemPrompt(): string {
		return `You are an intelligent chat completion assistant. Your task is to complete the user's message naturally based on the provided context.

## RULES
- Provide a natural, conversational completion
- Be concise - typically 1-15 words
- Match the user's tone and style
- Use context from visible code if relevant
- NEVER repeat what the user already typed
- NEVER start with comments (//, /*, #)
- If the user is in the middle of typing a word (e.g., "hel"), include the COMPLETE word in your response (e.g., "hello world" not just "lo world")
- This allows proper prefix matching to remove the overlap correctly
- Return ONLY the completion text, no explanations or formatting`
	}

	/**
	 * Get user prompt for chat-based completion
	 */
	private getChatUserPrompt(prefix: string): string {
		return `${prefix}

TASK: Complete the user's message naturally. 
- If the user is mid-word (e.g., typed "hel"), return the COMPLETE word (e.g., "hello world") so prefix matching can work correctly
- Return ONLY the completion text (what comes next), no explanations.`
	}

	/**
	 * Build the prefix for FIM completion with visible code context and additional sources
	 */
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

	/**
	 * Get clipboard content for context
	 */
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

	/**
	 * Clean the suggestion by removing any leading repetition of user text
	 * and filtering out unwanted patterns like comments
	 */
	private cleanSuggestion(suggestion: string, userText: string): string {
		let cleaned = suggestion

		cleaned = removePrefixOverlap(cleaned, userText)

		const firstNewline = cleaned.indexOf("\n")
		if (firstNewline !== -1) {
			cleaned = cleaned.substring(0, firstNewline)
		}
		cleaned = cleaned.trimEnd() // Do NOT trim the end of the suggestion

		// Filter out suggestions that start with comment patterns
		// This happens because the context uses // prefixes for labels
		if (this.isUnwantedSuggestion(cleaned)) {
			return ""
		}

		return cleaned
	}

	/**
	 * Check if suggestion should be filtered out
	 */
	public isUnwantedSuggestion(suggestion: string): boolean {
		// Filter comment-starting suggestions
		if (suggestion.startsWith("//") || suggestion.startsWith("/*") || suggestion.startsWith("*")) {
			return true
		}

		// Filter suggestions that look like code rather than natural language
		// This includes preprocessor directives (#include) and markdown headers
		// Chat is for natural language, not formatted documents
		if (suggestion.startsWith("#")) {
			return true
		}

		// Filter suggestions that are just punctuation or whitespace
		if (suggestion.length < 2 || /^[\s\p{P}]+$/u.test(suggestion)) {
			return true
		}

		return false
	}
}
