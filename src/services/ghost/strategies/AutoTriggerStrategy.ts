import { AutocompleteInput, PromptResult } from "../types"
import { CURSOR_MARKER } from "../ghostConstants"
import { getBaseSystemInstructions } from "./StrategyHelpers"
import { isCommentLine } from "./CommentHelpers"

export class AutoTriggerStrategy {
	/**
	 * Determine if we should treat the current context as a comment
	 * by checking if the line at cursor position looks like a comment
	 */
	shouldTreatAsComment(input: AutocompleteInput, prefix: string, languageId: string): boolean {
		// Get the current line from the prefix
		const lines = prefix.split("\n")
		const currentLine = lines[lines.length - 1] || ""
		const previousLine = lines.length > 1 ? lines[lines.length - 2].trim() : ""

		if (isCommentLine(currentLine, languageId)) {
			return true
		} else if (currentLine.trim() === "" && previousLine) {
			return isCommentLine(previousLine, languageId)
		} else {
			return false
		}
	}

	/**
	 * Generate prompts for autocomplete request
	 * Returns PromptResult with system/user prompts and prefix/suffix
	 */
	getPrompts(input: AutocompleteInput, prefix: string, suffix: string, languageId: string): PromptResult {
		const isComment = this.shouldTreatAsComment(input, prefix, languageId)

		return {
			systemPrompt: isComment ? this.getCommentsSystemInstructions() : this.getSystemInstructions(),
			userPrompt: isComment
				? this.getCommentsUserPrompt(input, prefix, suffix, languageId)
				: this.getUserPrompt(input, prefix, suffix),
			prefix,
			suffix,
			completionId: input.completionId,
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
	getUserPrompt(input: AutocompleteInput, prefix: string, suffix: string): string {
		let prompt = ""

		// Start with recent typing context
		if (input.recentlyEditedRanges && input.recentlyEditedRanges.length > 0) {
			prompt += "## Recent Typing\n"
			input.recentlyEditedRanges.forEach((range, index) => {
				const description = `Edited ${range.filepath} at line ${range.range.start.line}`
				prompt += `${index + 1}. ${description}\n`
			})
			prompt += "\n"
		}

		// Add current position
		prompt += `## Current Position\n`
		prompt += `Line ${input.pos.line + 1}, Character ${input.pos.character + 1}\n\n`

		// Add the full code with cursor marker
		prompt += "## Full Code\n"
		prompt += prefix + CURSOR_MARKER + suffix
		prompt += "\n\n"

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

	getCommentsUserPrompt(input: AutocompleteInput, prefix: string, suffix: string, languageId: string): string {
		// Extract the comment from the prefix
		const lines = prefix.split("\n")
		const currentLine = lines[lines.length - 1] || ""
		const previousLine = lines.length > 1 ? lines[lines.length - 2] : ""

		// Get the comment line (either current or previous)
		let commentLine = ""
		if (isCommentLine(currentLine, languageId)) {
			commentLine = currentLine
		} else if (currentLine.trim() === "" && isCommentLine(previousLine, languageId)) {
			commentLine = previousLine
		}

		// Clean the comment (remove comment markers)
		const comment = this.cleanCommentForLanguage(commentLine, languageId)

		let prompt = `## Comment-Driven Development
- Language: ${languageId}
- Comment to Implement:
\`\`\`
${comment}
\`\`\`

## Full Code
${prefix}${CURSOR_MARKER}${suffix}

## Instructions
Generate code that implements the functionality described in the comment.
The code should be placed at the cursor position (${CURSOR_MARKER}).
Focus on implementing exactly what the comment describes.
`
		return prompt
	}

	/**
	 * Clean comment markers from a comment line
	 */
	private cleanCommentForLanguage(commentLine: string, languageId: string): string {
		let cleaned = commentLine.trim()

		// Remove common comment markers
		const patterns = [/^\/\/\s*/, /^\/\*\s*/, /\s*\*\/$/, /^#\s*/, /^--\s*/, /^<!--\s*/, /\s*-->$/]

		for (const pattern of patterns) {
			cleaned = cleaned.replace(pattern, "")
		}

		return cleaned.trim()
	}
}
