import type { Range, TextDocument } from "vscode"
import { GhostSuggestionContext } from "../types"
import { PromptStrategy } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
import { formatDiagnostics, formatDocumentWithCursor, getBaseSystemInstructions } from "./StrategyHelpers"

export class UserRequestStrategy implements PromptStrategy {
	name = "User Request"

	canHandle(context: GhostSuggestionContext): boolean {
		return !!context.userInput && context.userInput.trim().length > 0
	}

	getSystemInstructions(customInstructions?: string): string {
		return (
			getBaseSystemInstructions() +
			`Task: Execute User's Explicit Request
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
		)
	}

	/**
	 * Build the user prompt with all relevant context
	 */
	getUserPrompt(context: GhostSuggestionContext): string {
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
			prompt += formatDiagnostics(context.diagnostics)
			prompt += "\n"
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += formatDocumentWithCursor(context.document, context.range)
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
	 * Gets the file path from the document
	 */
	private getFilePath(document: TextDocument): string {
		return document.uri.toString()
	}

	/**
	 * Formats selected text for inclusion in prompts
	 */
	private formatSelectedText(document: TextDocument, range: Range): string {
		if (range.isEmpty) return ""

		const selectedText = document.getText(range)
		const startLine = range.start.line + 1
		const endLine = range.end.line + 1

		return `## Selected Code (Lines ${startLine}-${endLine})
\`\`\`${document.languageId}
${selectedText}
\`\`\``
	}
}
