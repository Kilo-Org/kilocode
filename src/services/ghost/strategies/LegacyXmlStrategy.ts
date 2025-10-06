import { GhostSuggestionContext } from "../types"
import { StreamingParseResult, GhostStreamingParser } from "../GhostStreamingParser"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { GhostContextError, GhostStrategyError } from "../errors/GhostErrors"

/**
 * Legacy XML Prompt Strategy using GhostStreamingParser.
 * Uses XML format with <change><search><replace> blocks and the original
 * GhostStreamingParser for proper XML handling and suggestion generation.
 */
export class LegacyXmlStrategy implements PromptStrategy {
	public readonly name: string = "Legacy XML"
	public readonly type: UseCaseType = UseCaseType.AUTO_TRIGGER

	private streamingParser: GhostStreamingParser
	private context?: GhostSuggestionContext
	private accumulatedResponse: string = ""

	constructor() {
		this.streamingParser = new GhostStreamingParser()
	}

	/**
	 * Legacy XML Strategy can handle most general contexts
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		// Default strategy - accepts all contexts
		return context.document !== undefined
	}

	/**
	 * Get relevant context for Legacy XML analysis
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		// Return basic context for compatibility
		return {
			document: context.document,
			range: context.range,
			diagnostics: context.diagnostics,
		}
	}

	/**
	 * Generate system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string {
		const baseInstructions = `You are a code completion assistant. Complete the code at the cursor position.

Output Format:
<change>
<search><![CDATA[exact text to find]]></search>
<replace><![CDATA[replacement text]]></replace>
</change>

Examples:

Complete a method call:
<change>
<search><![CDATA[const names = users.]]></search>
<replace><![CDATA[const names = users.map(u => u.name);]]></replace>
</change>

Complete a function body:
<change>
<search><![CDATA[function greet(name) {
	   ]]></search>
<replace><![CDATA[function greet(name) {
	   return \`Hello, \${name}!\`;]]></replace>
</change>

Add missing code:
<change>
<search><![CDATA[if (user) {
}]]></search>
<replace><![CDATA[if (user) {
	   console.log(user.name);
}]]></replace>
</change>`

		if (customInstructions) {
			return `${baseInstructions}\n\n${customInstructions}`
		}
		return baseInstructions
	}

	/**
	 * Build user prompt with context for Legacy XML strategy.
	 * Throws GhostContextError for unexpected failures (programming errors).
	 */
	async getUserPrompt(context: GhostSuggestionContext): Promise<string> {
		try {
			this.validateContext(context)

			const document = context.document!
			const range = context.range!
			const position = range.start

			// Get document content and cursor position
			const fullText = document.getText()
			const cursorOffset = document.offsetAt(position)

			// Extract context around cursor
			const beforeCursor = fullText.substring(0, cursorOffset)
			const afterCursor = fullText.substring(cursorOffset)

			// Create a simple prompt with context
			const prompt = `Complete the code at the cursor position:

\`\`\`${document.languageId}
${beforeCursor}<<<CURSOR>>>${afterCursor}
\`\`\`

Provide the completion using the XML format specified in the system instructions.`

			return prompt
		} catch (error) {
			throw new GhostStrategyError(
				`Failed to generate Legacy XML prompt: ${error instanceof Error ? error.message : String(error)}`,
				this.name,
				"prompt_generation",
			)
		}
	}

	/**
	 * Initialize processing for Legacy XML response
	 */
	initializeProcessing(context: GhostSuggestionContext): void {
		this.reset()
		this.context = context
		this.validateContext(context)
		// Initialize the streaming parser with context
		this.streamingParser.initialize(context)
	}

	/**
	 * Process response chunk using the GhostStreamingParser
	 */
	processResponseChunk(chunk: string): StreamingParseResult {
		return this.streamingParser.processChunk(chunk)
	}

	/**
	 * Finish processing using the GhostStreamingParser
	 */
	finishProcessing(): StreamingParseResult {
		return this.streamingParser.finishStream()
	}

	/**
	 * Reset parser state
	 */
	reset(): void {
		this.accumulatedResponse = ""
		this.streamingParser.reset()
	}

	/**
	 * Helper method to validate context
	 */
	private validateContext(context: GhostSuggestionContext): void {
		if (!context.document) {
			throw new GhostContextError("Document context is required", "document")
		}
		if (!context.range) {
			throw new GhostContextError("Range context is required", "range")
		}
	}
}
