import { GhostSuggestionContext } from "../types"
import { BasePromptStrategy } from "./BasePromptStrategy"
import { UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * Strategy for refactoring selected code
 * High priority for explicit selection actions
 */
export class SelectionRefactorStrategy extends BasePromptStrategy {
	name = "Selection Refactor"
	type = UseCaseType.SELECTION_REFACTOR

	canHandle(context: GhostSuggestionContext): boolean {
		// Handle when there's a selection but no explicit user input
		// (User input with selection is handled by UserRequestStrategy)
		return !!(context.range && !context.range.isEmpty && !context.userInput)
	}

	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
			diagnostics: context.diagnostics,
			documentAST: context.documentAST,
			rangeASTNode: context.rangeASTNode,
		}
	}

	protected getSpecificSystemInstructions(): string {
		return `You are an expert code refactoring assistant. Your task is to improve selected code while maintaining its functionality.

## Core Responsibilities:
1. Analyze the selected code for improvement opportunities
2. Apply best practices and design patterns
3. Improve readability and maintainability
4. Optimize performance where applicable
5. Ensure backward compatibility

## Refactoring Guidelines:
- Extract complex logic into well-named functions
- Reduce code duplication
- Improve variable and function names
- Simplify conditional logic
- Apply SOLID principles where appropriate
- Add or improve type annotations (for typed languages)
- Consider edge cases and error handling

## Output Requirements:
- Provide ONLY the refactored code
- Maintain the same functionality
- Preserve the original indentation level
- Include brief inline comments for significant changes
- Do not include explanations outside the code

Remember: The goal is to improve the code quality while keeping the exact same behavior.`
	}

	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
		if (!context.document || !context.range) {
			return "No selection available for refactoring."
		}

		const selectedCode = context.document.getText(context.range)
		const language = context.document.languageId

		// Analyze what kind of refactoring might be needed
		const refactoringSuggestions = this.analyzeRefactoringNeeds(selectedCode)

		let prompt = `## Selection Refactoring Context\n`
		prompt += `- Language: ${language}\n`
		prompt += `- Selected Code Lines: ${context.range.start.line + 1}-${context.range.end.line + 1}\n`
		prompt += `- Refactoring Suggestions: ${refactoringSuggestions.slice(0, 3).join(", ")}\n\n`

		if (context.diagnostics && context.diagnostics.length > 0) {
			prompt += this.formatDiagnostics(context.diagnostics)
			prompt += "\n"
		}

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
		prompt += `Refactor the selected code at the cursor position (${CURSOR_MARKER}) to improve its quality, readability, and maintainability.\n`
		prompt += `Focus on: ${refactoringSuggestions.slice(0, 3).join(", ")}\n`
		prompt += `Maintain the same functionality while improving the code structure.\n`

		return prompt
	}

	/**
	 * Analyzes code to suggest refactoring opportunities
	 */
	private analyzeRefactoringNeeds(code: string): string[] {
		const suggestions: string[] = []

		// Check for long functions
		const lines = code.split("\n")
		if (lines.length > 20) {
			suggestions.push("Consider extracting smaller functions")
		}

		// Check for deeply nested code
		const maxIndent = Math.max(...lines.map((line) => line.match(/^[\t ]*/)?.[0].length || 0))
		if (maxIndent > 12) {
			suggestions.push("Reduce nesting levels")
		}

		// Check for magic numbers
		if (/\b\d{2,}\b/.test(code) && !/["'].*\d{2,}.*["']/.test(code)) {
			suggestions.push("Extract magic numbers to named constants")
		}

		// Check for long lines
		if (lines.some((line) => line.length > 100)) {
			suggestions.push("Break long lines for better readability")
		}

		// Check for multiple responsibilities
		const functionMatches = code.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/g)
		if (functionMatches && functionMatches.length > 3) {
			suggestions.push("Consider single responsibility principle")
		}

		// Check for complex conditionals
		if (/if\s*\([^)]{50,}\)/.test(code) || /&&.*&&.*&&/.test(code) || /\|\|.*\|\|.*\|\|/.test(code)) {
			suggestions.push("Simplify complex conditional expressions")
		}

		// Check for duplicate code patterns
		const codePatterns = code.match(/\b\w+\s*\([^)]*\)/g) || []
		const seen = new Set<string>()
		const hasDuplicates = codePatterns.some((pattern) => {
			if (seen.has(pattern)) {
				return true
			}
			seen.add(pattern)
			return false
		})
		if (hasDuplicates) {
			suggestions.push("Remove code duplication")
		}

		// Check for poor naming
		if (/\b[a-z]\b(?!\.)/.test(code)) {
			suggestions.push("Improve variable naming")
		}

		// Default suggestion if no specific issues found
		if (suggestions.length === 0) {
			suggestions.push("Apply general best practices")
		}

		return suggestions
	}
}
