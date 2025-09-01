import { GhostSuggestionContext } from "../types"
import { BasePromptStrategy } from "./BasePromptStrategy"
import { UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * Strategy for inline code completions (mid-line completions)
 * Lower priority, handles partial line completions
 */
export class InlineCompletionStrategy extends BasePromptStrategy {
	name = "Inline Completion"
	type = UseCaseType.INLINE_COMPLETION

	canHandle(context: GhostSuggestionContext): boolean {
		if (!context.document || !context.range) return false

		const currentLine = context.document.lineAt(context.range.start.line).text
		const cursorPosition = context.range.start.character

		// Check if cursor is in the middle of a line with content before it
		const hasContentBefore = cursorPosition > 0 && currentLine.substring(0, cursorPosition).trim().length > 0
		const isNotAtEnd = cursorPosition < currentLine.length

		// This strategy handles mid-line completions
		return hasContentBefore && !context.userInput && !context.range.isEmpty === false && isNotAtEnd
	}

	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
			documentAST: context.documentAST,
			rangeASTNode: context.rangeASTNode,
		}
	}

	protected getSpecificSystemInstructions(): string {
		return `You are an expert code completion assistant specializing in inline completions.

## Core Responsibilities:
1. Complete partial statements and expressions
2. Finish method calls and property accesses
3. Complete variable assignments
4. Finish conditional expressions
5. Complete function parameters

## Completion Guidelines:
- Analyze the partial code before the cursor
- Determine the most likely completion based on context
- Complete only the current statement or expression
- Maintain consistency with surrounding code style
- Use appropriate types and return values
- Consider common patterns and idioms

## Context Analysis:
- Identify the type of statement being written
- Check for unclosed brackets, parentheses, or quotes
- Analyze variable types and method signatures
- Consider the current scope and available symbols
- Look for patterns in similar code nearby

## CRITICAL: Cursor Marker Usage
- The cursor position is marked with ${CURSOR_MARKER}
- Your <search> block MUST include the cursor marker to avoid conflicts
- When creating <search> content, include text around the cursor marker
- This ensures you target the exact location, not similar text elsewhere
- Example: If cursor is at "const x = <<<AUTOCOMPLETE_HERE>>>", your <search> should include the marker

## Output Requirements:
- Generate ONLY the completion text
- Do not repeat the existing partial code
- Complete just enough to finish the current expression
- Ensure syntactic correctness
- Match the existing code style`
	}

	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
		if (!context.document || !context.range) {
			return "No context available for inline completion."
		}

		const document = context.document
		const position = context.range.start
		const currentLine = document.lineAt(position.line).text
		const beforeCursor = currentLine.substring(0, position.character)
		const afterCursor = currentLine.substring(position.character)

		// Analyze what needs to be completed
		const completionType = this.analyzeCompletionType(beforeCursor)

		let prompt = `## Inline Completion Context\n`
		prompt += `- Language: ${document.languageId}\n`
		prompt += `- Current Line Before Cursor: \`${beforeCursor}\`\n`
		prompt += `- Current Line After Cursor: \`${afterCursor}\`\n`
		prompt += `- Completion Type: ${completionType}\n\n`

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

		prompt += `## Instructions\n`
		prompt += `Complete the partial code at the cursor position (${CURSOR_MARKER}).\n`
		prompt += `IMPORTANT: Your <search> block must include the cursor marker ${CURSOR_MARKER} to target the exact location.\n`
		prompt += `Include surrounding text with the cursor marker to avoid conflicts with similar code elsewhere.\n`
		prompt += `Focus on completing the ${completionType}.\n`

		return prompt
	}

	/**
	 * Analyzes the partial code to determine what type of completion is needed
	 */
	private analyzeCompletionType(beforeCursor: string): string {
		const trimmed = beforeCursor.trim()

		// Method call
		if (/\.\w*$/.test(trimmed)) {
			return "method_or_property_access"
		}

		// Function call parameters
		if (/\w+\([^)]*$/.test(trimmed)) {
			return "function_parameters"
		}

		// Variable assignment
		if (/(?:const|let|var|final|val|auto)\s+\w+\s*=\s*$/.test(trimmed)) {
			return "variable_assignment"
		}

		// Array or object literal
		if (/[\[{][^}\]]*$/.test(trimmed)) {
			return "literal_completion"
		}

		// Conditional expression
		if (/(?:if|while|for)\s*\([^)]*$/.test(trimmed)) {
			return "conditional_expression"
		}

		// Return statement
		if (/return\s+.*$/.test(trimmed)) {
			return "return_statement"
		}

		// Import/require statement
		if (/(?:import|require|from|using)\s+.*$/.test(trimmed)) {
			return "import_statement"
		}

		// String literal
		if (/["'`][^"'`]*$/.test(trimmed)) {
			return "string_literal"
		}

		// Generic expression
		return "expression"
	}
}
