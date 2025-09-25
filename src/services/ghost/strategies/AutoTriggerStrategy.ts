import { GhostSuggestionContext } from "../types"
import { UseCaseType } from "../types/PromptStrategy"
import { BasePromptStrategy } from "./BasePromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * Fallback strategy for automatic completions
 * handles all other cases with subtle suggestions
 */
export class AutoTriggerStrategy extends BasePromptStrategy {
	name = "Auto Trigger"
	type = UseCaseType.AUTO_TRIGGER

	/**
	 * Can handle any context (fallback strategy)
	 * Always returns true as this is the catch-all
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		// This is the fallback strategy, so it can handle anything
		// But we check for basic requirements
		return !!context.document
	}

	/**
	 * Minimal context for auto-trigger
	 * Focus on immediate context only
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
			recentOperations: context.recentOperations?.slice(0, 3), // Only last 3 operations
			// Exclude:
			// - userInput (no explicit request)
			// - diagnostics (not fixing errors)
			// - openFiles (reduces tokens)
			// - rangeASTNode (keep it simple)
		}
	}

	/**
	 * System instructions for auto-trigger
	 */
	protected getSpecificSystemInstructions(): string {
		return `Task: Subtle Auto-Completion
Provide non-intrusive completions after a typing pause. Be conservative and helpful.

Auto-Complete Rules:
- Small, obvious completions only
- Single line preferred (max 2-3 lines)
- Complete the current thought based on context
- Don't be creative or add new features
- Match exactly what seems to be typed
- Only suggest if there's a clear, obvious completion

Common Completions:
- Closing brackets, parentheses, or braces
- Semicolons at end of statements
- Simple property or method access
- Variable assignments after declaration
- Return statements in functions
- Import statements completion
- Simple loop or conditional bodies

Avoid:
- Multi-line complex suggestions
- New functionality or features
- Refactoring existing code
- Complex logic or algorithms
- Anything that changes program behavior significantly

## CRITICAL: Cursor Marker Usage
- The cursor position is marked with ${CURSOR_MARKER}
- Your <search> block MUST include the cursor marker to avoid conflicts
- When creating <search> content, include text around the cursor marker
- This ensures you target the exact location, not similar text elsewhere
- Example: If cursor is at "const x = <<<AUTOCOMPLETE_HERE>>>", your <search> should include the marker

Important:
- If nothing obvious to complete, provide NO suggestion
- Respect the user's coding style
- Keep suggestions minimal and predictable
- Focus on helping finish what's being typed`
	}

	/**
	 * Build minimal prompt for auto-trigger
	 */
	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
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

			// Analyze what might need completion
			const currentLine = context.document.lineAt(context.range.start.line).text
			const cursorChar = context.range.start.character
			prompt += this.analyzeCompletionContext(currentLine, cursorChar)
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += this.formatDocumentWithCursor(context.document, context.range)
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

	/**
	 * Analyze the current line to provide hints about what might need completion
	 */
	private analyzeCompletionContext(currentLine: string, cursorPosition: number): string {
		const beforeCursor = currentLine.substring(0, cursorPosition).trim()
		const afterCursor = currentLine.substring(cursorPosition).trim()

		let analysis = "## Completion Context\n"

		// Check for incomplete patterns
		if (beforeCursor.endsWith(".")) {
			analysis += "- Property or method access started\n"
		}
		if (beforeCursor.endsWith("(")) {
			analysis += "- Function call or declaration started\n"
		}
		if (beforeCursor.endsWith("{")) {
			analysis += "- Block or object literal started\n"
		}
		if (beforeCursor.endsWith("[")) {
			analysis += "- Array or index access started\n"
		}
		if (beforeCursor.match(/=\s*$/)) {
			analysis += "- Assignment started\n"
		}
		if (beforeCursor.match(/return\s*$/)) {
			analysis += "- Return statement started\n"
		}
		if (beforeCursor.match(/import\s+.*\s+from\s*$/)) {
			analysis += "- Import statement needs module\n"
		}
		if (beforeCursor.match(/^\s*(const|let|var)\s+\w+\s*$/)) {
			analysis += "- Variable declaration needs initialization\n"
		}

		// Check for missing closures
		const openParens = (beforeCursor.match(/\(/g) || []).length
		const closeParens = (beforeCursor.match(/\)/g) || []).length
		if (openParens > closeParens) {
			analysis += `- ${openParens - closeParens} unclosed parenthesis\n`
		}

		const openBrackets = (beforeCursor.match(/\[/g) || []).length
		const closeBrackets = (beforeCursor.match(/\]/g) || []).length
		if (openBrackets > closeBrackets) {
			analysis += `- ${openBrackets - closeBrackets} unclosed bracket\n`
		}

		const openBraces = (beforeCursor.match(/\{/g) || []).length
		const closeBraces = (beforeCursor.match(/\}/g) || []).length
		if (openBraces > closeBraces && !afterCursor.startsWith("}")) {
			analysis += `- ${openBraces - closeBraces} unclosed brace\n`
		}

		// Check if line might need semicolon
		if (
			!beforeCursor.endsWith(";") &&
			!beforeCursor.endsWith("{") &&
			!beforeCursor.endsWith("}") &&
			beforeCursor.length > 0 &&
			!afterCursor
		) {
			if (this.mightNeedSemicolon(beforeCursor)) {
				analysis += "- Statement might need semicolon\n"
			}
		}

		analysis += "\n"
		return analysis
	}

	/**
	 * Check if a line might need a semicolon
	 */
	private mightNeedSemicolon(line: string): boolean {
		const trimmed = line.trim()

		// Patterns that typically need semicolons
		const needsSemicolon = [
			/^(const|let|var)\s+\w+\s*=\s*.+$/, // Variable declaration with value
			/^\w+\s*=\s*.+$/, // Assignment
			/^\w+\.\w+\(.*\)$/, // Method call
			/^return\s+.+$/, // Return with value
			/^throw\s+.+$/, // Throw statement
			/^break$/, // Break statement
			/^continue$/, // Continue statement
			/^\w+\+\+$/, // Increment
			/^\w+--$/, // Decrement
		]

		return needsSemicolon.some((pattern) => pattern.test(trimmed))
	}
}
