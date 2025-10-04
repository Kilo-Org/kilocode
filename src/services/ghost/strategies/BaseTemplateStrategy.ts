import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as Handlebars from "handlebars"
import { GhostSuggestionContext } from "../types"
import { StreamingParseResult } from "../GhostStreamingParser"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { createSuggestionsFromCompletion } from "../utils/diffToOperations"
import { GhostContextError, GhostStrategyError, GhostTemplateError } from "../errors/GhostErrors"

/**
 * Base class for template-based strategies (FIM, HoleFill)
 * Eliminates code duplication and provides consistent error handling
 */
export abstract class BaseTemplateStrategy implements PromptStrategy {
	public abstract readonly name: string
	public abstract readonly type: UseCaseType

	protected context: GhostSuggestionContext | null = null
	protected accumulatedResponse: string = ""
	private template: HandlebarsTemplateDelegate | null = null
	private templatePath: string | null = null

	constructor(templateFileName: string) {
		this.templatePath = path.join(__dirname, "../templates/files", templateFileName)
	}

	/**
	 * All template strategies can handle any completion context
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		return context.document !== undefined
	}

	/**
	 * Get relevant context for template-based analysis
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
		}
	}

	/**
	 * Generate system instructions - must be implemented by subclasses
	 */
	abstract getSystemInstructions(customInstructions?: string): string

	/**
	 * Build user prompt with context using template
	 */
	async getUserPrompt(context: GhostSuggestionContext): Promise<string> {
		try {
			this.validateContext(context)

			// Load template if not already loaded
			if (!this.template) {
				await this.loadTemplate()
			}

			// Extract variables for template
			const variables = this.extractVariables(context)

			// Generate prompt using template
			const prompt = this.template!(variables)
			return prompt
		} catch (error) {
			throw new GhostStrategyError(
				`Failed to generate ${this.name} prompt: ${error instanceof Error ? error.message : String(error)}`,
				this.name,
				"prompt_generation",
			)
		}
	}

	/**
	 * Initialize processing
	 */
	initializeProcessing(context: GhostSuggestionContext): void {
		this.reset()
		this.context = context
		this.accumulatedResponse = ""
		this.validateContext(context)
	}

	/**
	 * Process response chunk - must be implemented by subclasses
	 */
	abstract processResponseChunk(chunk: string): StreamingParseResult

	/**
	 * Finish processing - must be implemented by subclasses
	 */
	abstract finishProcessing(): StreamingParseResult

	/**
	 * Reset parser state
	 */
	reset(): void {
		this.context = null
		this.accumulatedResponse = ""
	}

	/**
	 * Load and compile the Handlebars template asynchronously
	 */
	private async loadTemplate(): Promise<void> {
		try {
			if (!this.templatePath) {
				throw new GhostTemplateError("Template path not set")
			}

			const templateContent = await fs.readFile(this.templatePath, "utf8")
			this.template = Handlebars.compile(templateContent)
		} catch (error) {
			throw new GhostTemplateError(
				`Failed to load template: ${error instanceof Error ? error.message : String(error)}`,
				this.templatePath || undefined,
			)
		}
	}

	/**
	 * Extract template variables from Ghost context
	 */
	protected extractVariables(context: GhostSuggestionContext): Record<string, string> {
		if (!context.document || !context.range) {
			throw new GhostContextError("Invalid context: missing document or range")
		}

		const document = context.document
		const position = context.range.start
		const fullText = document.getText()
		const cursorOffset = document.offsetAt(position)

		// Extract prefix (text before cursor)
		const prefix = fullText.substring(0, cursorOffset)

		// Extract suffix (text after cursor)
		const suffix = fullText.substring(cursorOffset)

		return {
			prefix: prefix,
			suffix: suffix,
		}
	}

	/**
	 * Create suggestions from completion text using consolidated utility
	 */
	protected createSuggestionsFromCompletion(completionText: string): GhostSuggestionsState {
		if (!this.context) {
			return new GhostSuggestionsState()
		}

		// Use the consolidated utility (no targetLines for template strategies - uses cursor position)
		return createSuggestionsFromCompletion(completionText, this.context)
	}

	/**
	 * Helper method to validate context
	 */
	protected validateContext(context: GhostSuggestionContext): void {
		if (!context.document) {
			throw new GhostContextError("Document context is required", "document")
		}
		if (!context.range) {
			throw new GhostContextError("Range context is required", "range")
		}
	}

	/**
	 * Helper method to create empty result
	 */
	protected createEmptyResult(): StreamingParseResult {
		return {
			suggestions: new GhostSuggestionsState(),
			isComplete: false,
			hasNewSuggestions: false,
		}
	}

	/**
	 * Helper method to create complete result
	 */
	protected createCompleteResult(suggestions: GhostSuggestionsState): StreamingParseResult {
		return {
			suggestions,
			isComplete: true,
			hasNewSuggestions: suggestions.hasSuggestions(),
		}
	}
}
