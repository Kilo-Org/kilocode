import { AutocompleteInput } from "../types"
import { CURSOR_MARKER } from "./ghostConstants"
import { isCommentLine, cleanComment } from "./CommentHelpers"
import type { TextDocument, Range } from "vscode"

export function getBaseSystemInstructions(): string {
	return `CRITICAL OUTPUT FORMAT:
You must respond with a single hole-filling completion ONLY. No explanations or text outside the HOLE tags.

Format: <HOLE>content_to_insert</HOLE>

MANDATORY RULES:
- Respond with EXACTLY ONE <HOLE> tag containing the content to insert
- The <HOLE> tag MUST have a closing </HOLE> tag
- Do NOT include the <<HOLE>> marker itself in your response
- Only provide the content that should replace the <<HOLE>> marker
- No additional text, explanations, or XML outside the HOLE tags

CONTENT RULES:
- Provide minimal, contextually appropriate completion
- Match the indentation and style of surrounding code
- Complete only what appears to be the user's immediate intent
- If nothing obvious to complete, respond with empty <HOLE></HOLE>

EXAMPLE:
If the code shows:
function example() {
	<<HOLE>>
}

You might respond with:
<HOLE>console.log('hello');</HOLE>

--

`
}

export function addCursorMarker(document: TextDocument, range?: Range): string {
	if (!range) return document.getText()

	const fullText = document.getText()
	const cursorOffset = document.offsetAt(range.start)
	const beforeCursor = fullText.substring(0, cursorOffset)
	const afterCursor = fullText.substring(cursorOffset)

	return `${beforeCursor}${CURSOR_MARKER}${afterCursor}`
}

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

	getPrompts(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		languageId: string,
	): {
		systemPrompt: string
		userPrompt: string
	} {
		if (this.shouldTreatAsComment(prefix, languageId)) {
			return {
				systemPrompt: this.getCommentsSystemInstructions(),
				userPrompt: this.getCommentsUserPrompt(prefix, suffix, languageId),
			}
		} else {
			return {
				systemPrompt: this.getSystemInstructions(),
				userPrompt: this.getUserPrompt(autocompleteInput, prefix, suffix, languageId),
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
	getUserPrompt(autocompleteInput: AutocompleteInput, prefix: string, suffix: string, languageId: string): string {
		let prompt = ""

		// Start with recent typing context from autocompleteInput
		if (autocompleteInput.recentlyEditedRanges && autocompleteInput.recentlyEditedRanges.length > 0) {
			prompt += "## Recent Typing\n"
			autocompleteInput.recentlyEditedRanges.forEach((range, index) => {
				const description = `Edited ${range.filepath} at line ${range.range.start.line}`
				prompt += `${index + 1}. ${description}\n`
			})
			prompt += "\n"
		}

		// Add current position from autocompleteInput
		const line = autocompleteInput.pos.line + 1
		const char = autocompleteInput.pos.character + 1
		prompt += `## Current Position\n`
		prompt += `Line ${line}, Character ${char}\n\n`

		// Add the full document with cursor marker
		const codeWithCursor = `${prefix}${CURSOR_MARKER}${suffix}`
		prompt += "## Full Code\n"
		prompt += `\`\`\`${languageId}\n${codeWithCursor}\n\`\`\`\n\n`

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += `Fill the ${CURSOR_MARKER} marker with appropriate code.\n`
		prompt += `Provide a minimal, obvious completion at the hole position.\n`
		prompt += "Complete only what the user appears to be typing.\n"
		prompt += "Single line preferred, no new features.\n"
		prompt += "If nothing obvious to complete, respond with empty <HOLE></HOLE>.\n"

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
- Do not repeat the comment you are implementing in your output
- Do not add explanatory comments unless necessary for complex logic
- Ensure the code is production-ready
- Place the implementation at the <<HOLE>> marker position`
		)
	}

	getCommentsUserPrompt(prefix: string, suffix: string, languageId: string): string {
		// Extract the comment from the prefix
		const lines = prefix.split("\n")
		const lastLine = lines[lines.length - 1]
		const previousLine = lines.length > 1 ? lines[lines.length - 2] : ""

		// Determine which line contains the comment
		const commentLine = isCommentLine(lastLine, languageId) ? lastLine : previousLine
		const comment = cleanComment(commentLine, languageId)

		const codeWithCursor = `${prefix}${CURSOR_MARKER}${suffix}`

		let prompt = `## Comment-Driven Development
- Language: ${languageId}
- Comment to Implement:
\`\`\`
${comment}
\`\`\`

## Full Code
\`\`\`${languageId}
${codeWithCursor}
\`\`\`

## Instructions
Generate code that implements the functionality described in the comment.
Fill the ${CURSOR_MARKER} marker with the implementation.
Focus on implementing exactly what the comment describes.
`
		return prompt
	}
}
