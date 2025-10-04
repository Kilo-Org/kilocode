import { GhostSuggestionContext } from "../types"
import { UseCaseType } from "../types/PromptGenerator"
import { BasePromptGenerator } from "./BasePromptGenerator"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * PromptGenerator for handling explicit user requests
 * This has the highest priority as it represents direct user intent
 */
export class UserRequestPromptGenerator extends BasePromptGenerator {
	name = "User Request"
	type = UseCaseType.USER_REQUEST

	/**
	 * Can handle any context that has user input
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		return !!context.userInput && context.userInput.trim().length > 0
	}

	/**
	 * Include user input, document, selection, and diagnostics
	 * Exclude recent operations and open files as they're less relevant
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			userInput: context.userInput,
			range: context.range,
			diagnostics: context.diagnostics,
			rangeASTNode: context.rangeASTNode,
			// Explicitly exclude:
			// - recentOperations (not needed for explicit requests)
			// - openFiles (reduces token usage)
			// - documentAST (full AST not needed, rangeASTNode is enough)
		}
	}

	/**
	 * System instructions specific to user requests
	 */
	protected getSpecificSystemInstructions(): string {
		return `Task: Execute User's Explicit Request
You are responding to a direct user instruction. Your primary goal is to fulfill their specific request accurately.

Priority Order:
1. User's explicit intent (what they asked for)
2. Code correctness and functionality
3. Code style and conventions

Response Guidelines:
- Focus entirely on what the user requested
- If the request is ambiguous, make reasonable assumptions based on context
- Provide complete implementations, not partial code
- Add necessary imports or dependencies if needed
- If the user asks to "fix", look for errors or issues to resolve
- If the user asks to "add", implement new functionality
- If the user asks to "refactor", improve code structure without changing behavior
- If the user asks to "optimize", improve performance or readability

Common Request Patterns:
- "add error handling" → wrap in try-catch, add validation
- "make async" → convert to async/await pattern
- "add types" → add TypeScript type annotations
- "add comments" → add JSDoc or inline comments
- "extract function" → move selected code to a new function
- "fix" → resolve errors, warnings, or obvious issues`
	}

	/**
	 * Build the user prompt with all relevant context
	 */
	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
		let prompt = ""

		// User request is the most important part
		prompt += `## User Request\n"${context.userInput}"\n\n`

		// Add file context
		if (context.document) {
			prompt += `## Current Code Context\n`
			prompt += `- File: ${this.getFilePath(context.document)}\n`
			prompt += `- Language: ${context.document.languageId}\n`

			// Add line count for context
			const lineCount = context.document.lineCount
			prompt += `- Total Lines: ${lineCount}\n\n`
		}

		// If there's a selection, highlight it
		if (context.range && !context.range.isEmpty && context.document) {
			prompt += this.formatSelectedText(context.document, context.range)
			prompt += "\n"
			prompt += "**Note**: The user has selected this specific code. "
			prompt += "Focus your changes on this selection unless the request requires changes elsewhere.\n\n"
		}

		// Include diagnostics if present (user might be asking to fix them)
		if (context.diagnostics && context.diagnostics.length > 0) {
			prompt += this.formatDiagnostics(context.diagnostics)
			prompt += "\n"
		}

		// Add AST context if available
		if (context.rangeASTNode) {
			prompt += this.formatASTContext(context.rangeASTNode)
			prompt += "\n"
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += this.formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += `Generate changes that directly implement: "${context.userInput}"\n`

		if (context.range && context.document) {
			prompt += `Start with changes at the cursor position (${CURSOR_MARKER}).\n`

			// Add context-specific hints
			if (context.range.isEmpty) {
				prompt += "The cursor is at a specific position - consider adding new code there if appropriate.\n"
			} else {
				prompt += "The user has selected code - focus on modifying or replacing the selection.\n"
			}
		}

		// Add hints based on common request patterns
		const request = context.userInput?.toLowerCase() || ""
		if (request.includes("fix")) {
			prompt += "Look for errors, warnings, or issues that need to be resolved.\n"
		} else if (request.includes("add") || request.includes("implement")) {
			prompt += "Add new functionality as requested, ensuring it integrates well with existing code.\n"
		} else if (request.includes("refactor") || request.includes("improve")) {
			prompt += "Improve code structure and readability while maintaining the same functionality.\n"
		} else if (request.includes("test")) {
			prompt += "Generate appropriate test cases or test-related code.\n"
		} else if (request.includes("comment") || request.includes("document")) {
			prompt += "Add clear, helpful comments or documentation.\n"
		}

		return prompt
	}

	/**
	 * Override to provide more context for certain types of requests
	 */
	override getUserPrompt(context: GhostSuggestionContext): string {
		// For certain requests, we might want to include more context
		const request = context.userInput?.toLowerCase() || ""

		// If the request mentions other files or imports, include more context
		if (request.includes("import") || request.includes("from")) {
			// Could potentially include information about available modules
			// For now, we'll use the standard approach
		}

		// Use the standard prompt building
		return super.getUserPrompt(context)
	}
}
