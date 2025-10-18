import { GhostSuggestionContext, extractPrefix } from "../types"
import { CURSOR_MARKER } from "../ghostConstants"
import { formatDocumentWithCursor, getBaseSystemInstructions } from "./StrategyHelpers"
import { isCommentLine, extractComment, cleanComment } from "./CommentHelpers"

export class AutoTriggerStrategy {
	shouldTreatAsComment(prefix: string, languageId: string): boolean {
		const lines = prefix.split("\n")
		const currentLine = lines[lines.length - 1].trim() || ""
		const previousLine = lines.length > 1 ? lines[lines.length - 2].trim() : ""

		if (isCommentLine(currentLine, languageId)) {
			return true
		} else if (currentLine === "" && previousLine) {
			return isCommentLine(previousLine, languageId)
		} else {
			return false
		}
	}

	getPrompts(context: GhostSuggestionContext): {
		systemPrompt: string
		userPrompt: string
	} {
		const prefix = extractPrefix(context)
		const languageId = context.document?.languageId || ""

		if (this.shouldTreatAsComment(prefix, languageId)) {
			return {
				systemPrompt: this.getCommentsSystemInstructions(),
				userPrompt: this.getCommentsUserPrompt(context),
			}
		} else {
			return {
				systemPrompt: this.getSystemInstructions(),
				userPrompt: this.getUserPrompt(context),
			}
		}
	}

	getSystemInstructions(): string {
		return (
			getBaseSystemInstructions() +
			`Task: Subtle Auto-Completion
Provide non-intrusive completions after a typing pause. Be conservative and helpful.

`
		)
	}

	/**
	 * Build minimal prompt for auto-trigger
	 */
	getUserPrompt(context: GhostSuggestionContext): string {
		let prompt = ""

		// Start with recent typing context
		if (context.recentOperations && context.recentOperations.length > 0) {
			prompt += "## Recent Typing\n"
			context.recentOperations.forEach((op, index) => {
				prompt += `${index + 1}. ${op.description}\n`
			})
			prompt += "\n"
		}

		// Add current position
		if (context.range && context.document) {
			const line = context.range.start.line + 1
			const char = context.range.start.character + 1
			prompt += `## Current Position\n`
			prompt += `Line ${line}, Character ${char}\n\n`
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += `Provide a minimal, obvious completion at the cursor position (${CURSOR_MARKER}).\n`
		prompt += `IMPORTANT: Your <search> block must include the cursor marker ${CURSOR_MARKER} to target the exact location.\n`
		prompt += `Include surrounding text with the cursor marker to avoid conflicts with similar code elsewhere.\n`
		prompt += "Complete only what the user appears to be typing.\n"
		prompt += "Single line preferred, no new features.\n"
		prompt += "If nothing obvious to complete, provide NO suggestion.\n"

		return prompt
	}

	getCommentsSystemInstructions(): string {
		return (
			getBaseSystemInstructions() +
			`You are an expert code generation assistant that implements code based on comments.

## Core Responsibilities:
1. Read and understand the comment's intent
2. Generate complete, working code that fulfills the comment's requirements
3. Follow the existing code style and patterns
4. Add appropriate error handling
5. Include necessary imports or dependencies

## Code Generation Guidelines:
- Generate only the code that directly implements the comment
- Match the indentation level of the comment
- Use descriptive variable and function names
- Follow language-specific best practices
- Add type annotations where appropriate
- Consider edge cases mentioned in the comment
- If the comment describes multiple steps, implement them all

## Comment Types to Handle:
- TODO comments: Implement the described task
- FIXME comments: Fix the described issue
- Implementation comments: Generate the described functionality
- Algorithm descriptions: Implement the described algorithm
- API/Interface descriptions: Implement the described interface

## Output Requirements:
- Generate ONLY executable code that implements the comment
- PRESERVE all existing code and comments in the provided context
- Do not repeat the comment you are implementing in your output
- Do not add explanatory comments unless necessary for complex logic
- Ensure the code is production-ready
- When using search/replace format, include ALL existing code to preserve it`
		)
	}

	getCommentsUserPrompt(context: GhostSuggestionContext): string {
		if (!context.document || !context.range) {
			return "No context available for comment-driven generation."
		}

		const language = context.document.languageId
		const comment = cleanComment(extractComment(context.document, context.range.start.line), language)

		let prompt = `## Comment-Driven Development
- Language: ${language}
- Comment to Implement:
\`\`\`
${comment}
\`\`\`

## Full Code
${formatDocumentWithCursor(context.document, context.range)}

## Instructions
Generate code that implements the functionality described in the comment.
The code should be placed at the cursor position (${CURSOR_MARKER}).
Focus on implementing exactly what the comment describes.
`
		return prompt
	}
}
