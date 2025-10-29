import { AutocompleteInput } from "../types"
import { CURSOR_MARKER } from "./ghostConstants"
import { isCommentLine, cleanComment } from "./CommentHelpers"
import type { TextDocument, Range } from "vscode"

export function getBaseSystemInstructions(): string {
	return `You are an expert code completion assistant. Your task is to provide intelligent, context-aware code completions.

CRITICAL OUTPUT FORMAT:
You must respond with EXACTLY ONE <HOLE>content</HOLE> tag. No explanations, no additional text.

Format: <HOLE>your_completion_here</HOLE>

MANDATORY RULES:
- Respond with EXACTLY ONE <HOLE> tag containing the completion
- The <HOLE> tag MUST have a closing </HOLE> tag
- Do NOT include the <HOLE></HOLE> marker itself in your response
- Only provide the content that should replace the <HOLE></HOLE> marker
- No additional text, explanations, or commentary outside the HOLE tags
- If you cannot provide a good completion, respond with empty <HOLE></HOLE>

COMPLETION QUALITY GUIDELINES:
1. **Context Awareness**: Analyze the surrounding code carefully
   - Understand the function/class/module context
   - Identify patterns and conventions in the existing code
   - Consider variable names, types, and scope

2. **Appropriate Scope**:
   - For single-line contexts: provide a single line completion
   - For function bodies: provide the complete implementation
   - For partial statements: complete the current statement
   - Match the granularity of what's being typed

3. **Code Quality**:
   - Follow the existing code style (indentation, naming, patterns)
   - Use appropriate language idioms and best practices
   - Include necessary error handling where appropriate
   - Add type annotations if the codebase uses them

4. **Precision**:
   - Complete only what the user is actively typing
   - Don't add unrelated features or refactorings
   - Prefer conservative, obvious completions
   - When in doubt, provide less rather than more

EXAMPLES:

Example 1 - Simple statement completion:
Code: const result = <HOLE></HOLE>
Response: <HOLE>calculateTotal(items)</HOLE>

Example 2 - Function implementation:
Code: function fibonacci(n: number): number {
	<HOLE></HOLE>
}
Response: <HOLE>if (n <= 1) return n;
	return fibonacci(n - 1) + fibonacci(n - 2);</HOLE>

Example 3 - Conditional logic:
Code: if (user.isAuthenticated) {
	<HOLE></HOLE>
}
Response: <HOLE>return user.profile;</HOLE>

Example 4 - No obvious completion:
Code: // Random comment
<HOLE></HOLE>
Response: <HOLE></HOLE>

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

		// Add language context
		prompt += `## Language\n${languageId}\n\n`

		// Start with recent typing context from autocompleteInput
		if (autocompleteInput.recentlyEditedRanges && autocompleteInput.recentlyEditedRanges.length > 0) {
			prompt += "## Recent Edits\n"
			autocompleteInput.recentlyEditedRanges.forEach((range, index) => {
				const description = `${range.filepath} at line ${range.range.start.line + 1}`
				prompt += `${index + 1}. ${description}\n`
			})
			prompt += "\n"
		}

		// Add current position from autocompleteInput
		const line = autocompleteInput.pos.line + 1
		const char = autocompleteInput.pos.character + 1
		prompt += `## Cursor Position\n`
		prompt += `Line ${line}, Column ${char}\n\n`

		// Add the full document with cursor marker
		const codeWithCursor = `${prefix}${CURSOR_MARKER}${suffix}`
		prompt += "## Code Context\n"
		prompt += `\`\`\`${languageId}\n${codeWithCursor}\n\`\`\`\n\n`

		// Add specific instructions
		prompt += "## Task\n"
		prompt += `Analyze the code and provide an intelligent completion for the <HOLE></HOLE> marker.\n\n`

		prompt += "**What to complete:**\n"
		prompt += "- Look at what the user is typing (the prefix before <HOLE></HOLE>)\n"
		prompt += "- Consider the context after the cursor (the suffix)\n"
		prompt += "- Understand the intent from surrounding code patterns\n"
		prompt += "- Provide the most logical next piece of code\n\n"

		prompt += "**Completion guidelines:**\n"
		prompt += "- Match the indentation level exactly\n"
		prompt += "- Follow the existing code style and conventions\n"
		prompt += "- For incomplete statements: complete the current line\n"
		prompt += "- For function bodies: provide the implementation\n"
		prompt += "- For partial expressions: complete the expression\n"
		prompt += "- Keep it focused and relevant to the immediate context\n\n"

		prompt += "**Response format:**\n"
		prompt += `Respond with: <HOLE>your_completion</HOLE>\n`
		prompt += "If no clear completion is appropriate, respond with: <HOLE></HOLE>\n"

		return prompt
	}

	getCommentsSystemInstructions(): string {
		return (
			getBaseSystemInstructions() +
			`
## COMMENT-DRIVEN CODE GENERATION

You are implementing code based on a developer's comment. This is a powerful workflow where comments describe intent and you generate the implementation.

### Understanding Comments:
1. **Read carefully**: Extract the exact requirement from the comment
2. **Infer context**: Use surrounding code to understand patterns and conventions
3. **Match scope**: Generate code that matches the comment's level of detail
4. **Be complete**: Implement everything the comment describes

### Comment Types & Responses:

**TODO comments**: Implement the described task
- Example: "// TODO: validate email format"
- Response: Full validation logic with regex or library

**FIXME comments**: Fix the described issue
- Example: "// FIXME: handle null case"
- Response: Add null check and appropriate handling

**Implementation comments**: Generate described functionality
- Example: "// Calculate fibonacci sequence"
- Response: Complete algorithm implementation

**Algorithm descriptions**: Implement the algorithm
- Example: "// Binary search for target value"
- Response: Full binary search implementation

### Code Quality Requirements:
- **Production-ready**: Include error handling, edge cases, type safety
- **Style-matched**: Follow existing code conventions exactly
- **Well-structured**: Use clear variable names, proper indentation
- **Complete**: Don't leave TODOs or placeholders in your implementation
- **Focused**: Only implement what the comment describes, nothing extra

### Special Considerations:
- If comment mentions specific libraries/APIs, use them
- If comment describes multiple steps, implement all of them
- If comment is vague, provide a reasonable, safe implementation
- Match the complexity level implied by the comment
- Consider the broader context (class, module, function scope)

### Output Format:
Place your implementation in <HOLE>implementation_code</HOLE>
Do NOT repeat the comment itself in your output.`
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

		let prompt = `## Comment-Driven Code Generation

**Language**: ${languageId}

**Comment to Implement**:
\`\`\`
${comment}
\`\`\`

## Code Context
\`\`\`${languageId}
${codeWithCursor}
\`\`\`

## Your Task
1. **Analyze** the comment to understand what needs to be implemented
2. **Examine** the surrounding code for context, patterns, and style
3. **Generate** production-ready code that fulfills the comment's requirements
4. **Place** your implementation at the <HOLE></HOLE> marker

## Requirements
- Implement EXACTLY what the comment describes
- Match the indentation and code style of surrounding code
- Include appropriate error handling and edge cases
- Use type annotations if the codebase uses them
- Follow language-specific best practices
- Make the code production-ready (no TODOs or placeholders)

## Response Format
<HOLE>your_implementation_here</HOLE>

Do NOT include the comment itself in your response.
`
		return prompt
	}
}
