import * as vscode from "vscode"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { VisibleCodeContext } from "../types"
import { ApiStreamChunk } from "../../../api/transform/stream"

/**
 * Service for providing FIM-based autocomplete suggestions in ChatTextArea
 */
export class ChatTextAreaAutocomplete {
	private model: GhostModel
	private providerSettingsManager: ProviderSettingsManager

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.model = new GhostModel()
		this.providerSettingsManager = providerSettingsManager
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

		const prefix = await this.buildPrefix(userText, visibleCodeContext)
		const suffix = ""

		let response = ""

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

		const cleanedSuggestion = this.cleanSuggestion(response, userText)

		return { suggestion: cleanedSuggestion }
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
- Return ONLY the completion text, no explanations or formatting`
	}

	/**
	 * Get user prompt for chat-based completion
	 */
	private getChatUserPrompt(prefix: string): string {
		return `${prefix}

TASK: Complete the user's message naturally. Return ONLY the completion text (what comes next), no explanations.`
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
		let cleaned = suggestion.trim()

		if (cleaned.startsWith(userText)) {
			cleaned = cleaned.substring(userText.length)
		}

		const firstNewline = cleaned.indexOf("\n")
		if (firstNewline !== -1) {
			cleaned = cleaned.substring(0, firstNewline)
		}

		cleaned = cleaned.trimStart()

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
