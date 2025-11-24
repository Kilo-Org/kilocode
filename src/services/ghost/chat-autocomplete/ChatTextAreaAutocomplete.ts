import * as vscode from "vscode"
import { GhostModel } from "../GhostModel"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { VisibleCodeContext } from "../types"

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

	isFimAvailable(): boolean {
		return this.model.loaded && this.model.supportsFim()
	}

	async getCompletion(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<{ suggestion: string }> {
		if (!this.model.loaded) {
			const loaded = await this.initialize()
			if (!loaded) {
				return { suggestion: "" }
			}
		}

		if (!this.model.supportsFim()) {
			console.log("[ChatTextAreaAutocomplete] FIM not supported by current model")
			return { suggestion: "" }
		}

		const prefix = await this.buildPrefix(userText, visibleCodeContext)
		const suffix = ""

		console.log("[ChatTextAreaAutocomplete] === FIM Request ===")
		console.log("[ChatTextAreaAutocomplete] User text:", JSON.stringify(userText))
		console.log("[ChatTextAreaAutocomplete] Full prefix:\n", prefix)

		let response = ""
		await this.model.generateFimResponse(prefix, suffix, (chunk) => {
			response += chunk
		})

		console.log("[ChatTextAreaAutocomplete] === FIM Response ===")
		console.log("[ChatTextAreaAutocomplete] Raw response:", JSON.stringify(response))

		const cleanedSuggestion = this.cleanSuggestion(response, userText)

		console.log("[ChatTextAreaAutocomplete] Cleaned suggestion:", JSON.stringify(cleanedSuggestion))

		return { suggestion: cleanedSuggestion }
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
		} catch (error) {
			console.log("[ChatTextAreaAutocomplete] Error getting clipboard:", error)
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
			console.log("[ChatTextAreaAutocomplete] Filtered unwanted suggestion:", JSON.stringify(cleaned))
			return ""
		}

		if (cleaned.length > 100) {
			const lastSpace = cleaned.lastIndexOf(" ", 100)
			if (lastSpace > 50) {
				cleaned = cleaned.substring(0, lastSpace)
			} else {
				cleaned = cleaned.substring(0, 100)
			}
		}

		return cleaned
	}

	/**
	 * Check if suggestion should be filtered out
	 */
	private isUnwantedSuggestion(suggestion: string): boolean {
		// Filter comment-starting suggestions
		if (suggestion.startsWith("//") || suggestion.startsWith("/*") || suggestion.startsWith("*")) {
			return true
		}

		// Filter suggestions that look like code rather than natural language
		// These patterns indicate the model is completing code, not a user message
		if (suggestion.startsWith("#") && !suggestion.startsWith("# ")) {
			// Allow "# " as it might be markdown header, but filter "#include" etc.
			return true
		}

		// Filter suggestions that are just punctuation or whitespace
		if (suggestion.length < 2 || /^[\s\p{P}]+$/u.test(suggestion)) {
			return true
		}

		return false
	}
}
