import { CodeContext } from "./ContextGatherer"

/**
 * Interface for prompt options
 */
export interface PromptOptions {
	maxTokens: number
	temperature: number
	language: string
	includeImports: boolean
	includeDefinitions: boolean
	multilineCompletions: boolean | "auto"
}

/**
 * Renders prompts for autocomplete
 */
export class PromptRenderer {
	private defaultOptions: PromptOptions = {
		maxTokens: 2048,
		temperature: 0.2,
		language: "typescript",
		includeImports: true,
		includeDefinitions: true,
		multilineCompletions: "auto",
	}

	/**
	 * Create a new prompt renderer
	 * @param options Prompt options
	 */
	constructor(options: Partial<PromptOptions> = {}) {
		this.defaultOptions = { ...this.defaultOptions, ...options }
	}

	/**
	 * Render a prompt for autocomplete
	 * @param context Code context
	 * @param options Prompt options
	 * @returns Rendered prompt
	 */
	renderPrompt(context: CodeContext, options: Partial<PromptOptions> = {}): string {
		const mergedOptions = { ...this.defaultOptions, ...options }
		const { language, includeImports, includeDefinitions, multilineCompletions } = mergedOptions

		// Start building the prompt
		let prompt = `You are an AI coding assistant that provides accurate and helpful code completions.
Language: ${language}

`

		// Add imports if requested
		if (includeImports && context.imports.length > 0) {
			prompt += `Relevant imports:\n${context.imports.join("\n")}\n\n`
		}

		// Add definitions if requested
		if (includeDefinitions && context.definitions.length > 0) {
			prompt += `Relevant definitions:\n`
			for (const def of context.definitions) {
				prompt += `// From ${def.filepath}\n${def.content}\n\n`
			}
		}

		// Add preceding code context
		if (context.precedingLines.length > 0) {
			prompt += `Preceding code:\n${context.precedingLines.join("\n")}\n`
		}

		// Add current line and cursor position
		prompt += `Current line: ${context.currentLine}\n`

		// Add following code context if available
		if (context.followingLines.length > 0) {
			prompt += `Following code:\n${context.followingLines.join("\n")}\n`
		}

		// Add instructions based on completion mode
		if (multilineCompletions === true) {
			prompt += `\nComplete the current line and continue with additional lines if appropriate. Focus on providing accurate, idiomatic ${language} code.`
		} else if (multilineCompletions === "auto") {
			prompt += `\nComplete the current line. If the line appears to be the start of a block (like a function, loop, or conditional), you may continue with the implementation of that block. Focus on providing accurate, idiomatic ${language} code.`
		} else {
			prompt += `\nComplete only the current line with accurate, idiomatic ${language} code.`
		}

		return prompt
	}

	/**
	 * Render a system prompt for autocomplete
	 * @returns System prompt
	 */
	renderSystemPrompt(): string {
		return `You are an AI coding assistant that provides accurate and helpful code completions.
Your task is to complete the code at the cursor position.
Provide only the completion text, without any explanations or markdown formatting.
The completion should be valid, syntactically correct code that fits the context.`
	}

	/**
	 * Extract completion from model response
	 * @param response Model response
	 * @returns Extracted completion
	 */
	extractCompletion(response: string): string {
		// Remove any markdown code block formatting
		let completion = response.trim()

		// Remove markdown code blocks if present
		const codeBlockRegex = /^```[\w]*\n([\s\S]*?)\n```$/
		const match = completion.match(codeBlockRegex)
		if (match) {
			completion = match[1]
		}

		// Remove any explanations or comments that might be at the beginning
		const lines = completion.split("\n")
		let startIndex = 0

		for (let i = 0; i < lines.length; i++) {
			if (
				lines[i].trim().startsWith("//") ||
				lines[i].trim().startsWith("#") ||
				lines[i].trim().startsWith("/*")
			) {
				startIndex = i + 1
			} else if (lines[i].trim() !== "") {
				break
			}
		}

		completion = lines.slice(startIndex).join("\n")

		return completion
	}
}
