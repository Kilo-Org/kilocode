import { StreamingParseResult } from "../GhostStreamingParser"
import { UseCaseType } from "../types/PromptStrategy"
import { BaseTemplateStrategy } from "./BaseTemplateStrategy"

/**
 * Fill-in-Middle Strategy for code models with native FIM support (Qwen, StarCoder, CodeLlama).
 * Uses simple FIM tokens and processes raw text responses without XML parsing.
 * Designed for models that understand <|fim_prefix|>, <|fim_suffix|>, <|fim_middle|> tokens.
 */
export class FimStrategy extends BaseTemplateStrategy {
	public readonly name: string = "Fill-in-Middle"
	public readonly type: UseCaseType = UseCaseType.INLINE_COMPLETION

	constructor() {
		super("standard-fim.hbs")
	}

	/**
	 * Generate system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string {
		const baseInstructions = `You are a Fill-in-Middle code completion model.
Complete the code between <|fim_prefix|> and <|fim_suffix|> tokens.
Provide only the missing code without any explanations or additional formatting.`

		if (customInstructions) {
			return `${baseInstructions}\n\n${customInstructions}`
		}
		return baseInstructions
	}

	/**
	 * Process response chunk - FIM models return raw text, accumulate until complete
	 */
	processResponseChunk(chunk: string): StreamingParseResult {
		this.accumulatedResponse += chunk

		// Check if response looks complete (contains stop tokens or seems finished)
		const stopTokens = ["<|endoftext|>", "<|fim_prefix|>", "<|fim_middle|>", "<|fim_suffix|>"]
		const hasStopToken = stopTokens.some((token) => this.accumulatedResponse.includes(token))

		if (hasStopToken) {
			// Clean up stop tokens from the response
			let cleanResponse = this.accumulatedResponse
			stopTokens.forEach((token) => {
				cleanResponse = cleanResponse.split(token)[0]
			})

			const trimmedResponse = cleanResponse.trim()
			if (trimmedResponse) {
				const suggestions = this.createSuggestionsFromCompletion(trimmedResponse)
				return this.createCompleteResult(suggestions)
			}
		}

		// Continue streaming - not complete yet
		return this.createEmptyResult()
	}

	/**
	 * Finish processing - handle any remaining content
	 */
	finishProcessing(): StreamingParseResult {
		// Clean up any stop tokens and reasoning blocks
		const cleanResponse = this.cleanResponse(this.accumulatedResponse)

		const trimmedResponse = cleanResponse.trim()
		if (trimmedResponse) {
			const suggestions = this.createSuggestionsFromCompletion(trimmedResponse)
			return this.createCompleteResult(suggestions)
		}

		return this.createEmptyResult()
	}

	/**
	 * Clean response by removing stop tokens and reasoning blocks
	 */
	private cleanResponse(response: string): string {
		let cleaned = response

		// Remove stop tokens
		const stopTokens = ["<|endoftext|>", "<|fim_prefix|>", "<|fim_middle|>", "<|fim_suffix|>"]
		stopTokens.forEach((token) => {
			cleaned = cleaned.split(token)[0]
		})

		// Remove <think> reasoning blocks
		cleaned = this.removeThinkBlocks(cleaned)

		return cleaned
	}

	/**
	 * Remove <think>...</think> reasoning blocks from response
	 */
	private removeThinkBlocks(response: string): string {
		// Remove all <think>...</think> blocks (case insensitive, multiline)
		return response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
	}
}
