import { StreamingParseResult } from "../GhostStreamingParser"
import { UseCaseType } from "../types/PromptStrategy"
import { BaseTemplateStrategy } from "./BaseTemplateStrategy"

/**
 * Hole Fill Strategy for chat models (GPT, Claude, Granite).
 * Uses Handlebars templates to create hole-filler prompts and parses <COMPLETION> XML responses.
 * Designed for models without native fill-in-middle support.
 */
export class HoleFillStrategy extends BaseTemplateStrategy {
	public readonly name: string = "Hole Filler"
	public readonly type: UseCaseType = UseCaseType.INLINE_COMPLETION

	constructor() {
		super("hole-filler.hbs")
	}

	/**
	 * Generate system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string {
		const baseInstructions = `You are a code completion assistant.
Complete the missing code in the provided context.
Wrap your completion in <COMPLETION></COMPLETION> tags.
Provide only the missing code without any explanations or additional formatting.`

		if (customInstructions) {
			return `${baseInstructions}\n\n${customInstructions}`
		}
		return baseInstructions
	}

	/**
	 * Process response chunk - accumulate until we find <COMPLETION> tags
	 */
	processResponseChunk(chunk: string): StreamingParseResult {
		this.accumulatedResponse += chunk

		// Check if we have a complete <COMPLETION> block
		const completionMatch = this.accumulatedResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)

		if (completionMatch) {
			let completion = completionMatch[1].trim()
			// Clean up any leaked XML tags from the completion
			completion = this.cleanCompletionText(completion)
			if (completion) {
				const suggestions = this.createSuggestionsFromCompletion(completion)
				return this.createCompleteResult(suggestions)
			}
		}

		// Continue streaming - not complete yet
		return this.createEmptyResult()
	}

	/**
	 * Finish processing - extract any remaining completion
	 */
	finishProcessing(): StreamingParseResult {
		// Try to extract completion from accumulated response
		const completionMatch = this.accumulatedResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)

		if (completionMatch) {
			let completion = completionMatch[1].trim()
			// Clean up any leaked XML tags from the completion
			completion = this.cleanCompletionText(completion)
			if (completion) {
				const suggestions = this.createSuggestionsFromCompletion(completion)
				return this.createCompleteResult(suggestions)
			}
		}

		// If no completion tags found, try to use the raw response
		let trimmedResponse = this.accumulatedResponse.trim()
		if (trimmedResponse) {
			// Clean up any leaked XML tags from the raw response
			trimmedResponse = this.cleanCompletionText(trimmedResponse)
			const suggestions = this.createSuggestionsFromCompletion(trimmedResponse)
			return this.createCompleteResult(suggestions)
		}

		return this.createEmptyResult()
	}

	/**
	 * Clean completion text by removing any leaked XML tags
	 */
	private cleanCompletionText(text: string): string {
		return text
			.replace(/<\/?COMPLETION>/gi, "") // Remove <COMPLETION> and </COMPLETION> tags
			.replace(/<COMPLETION>/gi, "") // Remove any standalone opening tags
			.replace(/<\/COMPLETION>/gi, "") // Remove any standalone closing tags
			.trim()
	}
}
