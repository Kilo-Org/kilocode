import type { TextDocument, Range } from "vscode"
import { GhostSuggestionContext } from "../types"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
import { formatDocumentWithCursor, getBaseSystemInstructions } from "./StrategyHelpers"

export class NewLineCompletionStrategy implements PromptStrategy {
	name = "New Line Completion"
	type = UseCaseType.NEW_LINE

	canHandle(context: GhostSuggestionContext): boolean {
		if (!context.document || !context.range) return false

		const line = context.document.lineAt(context.range.start.line).text
		return line.trim() === ""
	}

	getSystemInstructions(customInstructions?: string): string {
		return (
			getBaseSystemInstructions() +
			`Task: Proactive Code Completion for New Lines
The user has created a new line. Suggest the most logical next code based on context.

Completion Guidelines:
- Analyze surrounding code structure
- Consider common patterns for the current context
- Be proactive but not overly creative
- Suggest complete, syntactically correct statements
- Keep suggestions concise (1-3 lines typically)
- Match the existing code style and indentation

Common Patterns to Consider:
- After if/else: complete the block or add else clause
- After function signature: add opening brace or return statement
- After loop declaration: add loop body
- Inside function near end: add return statement
- After variable declaration: initialize or use the variable
- After opening brace: add appropriate content for that block
- Before closing brace: complete any missing statements
- After comment: implement what the comment describes and preserve the comment

Context Clues:
- Check if previous line is incomplete (missing semicolon, etc.)
- Look for patterns in surrounding code
- Consider the current scope (function, class, module)
- Check indentation level for context
- Look at recent edits for user intent

Important:
- Don't add unnecessary code
- Respect existing code patterns and comments
- Maintain consistent style
- Consider the most likely next step`
		)
	}

	/**
	 * Build prompt focused on surrounding context
	 */
	getUserPrompt(context: GhostSuggestionContext): string {
		let prompt = ""

		// Start with cursor context
		if (context.range) {
			const lineNum = context.range.start.line + 1
			prompt += `## Cursor Context\n`
			prompt += `Line ${lineNum} (empty line)\n\n`
		}

		// Add recent operations if available
		if (context.recentOperations && context.recentOperations.length > 0) {
			prompt += this.formatRecentOperations(context.recentOperations)
			prompt += "\n"
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		// Add context analysis
		if (context.document && context.range) {
			const surrounding = this.getSurroundingCode(
				context.document,
				context.range,
				15, // More lines before
				10, // Fewer lines after
			)
			prompt += this.analyzeContext(surrounding, context)
		}

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += `Suggest the most logical code for the cursor position (${CURSOR_MARKER}).\n`
		prompt += "Consider the pattern being established and complete it naturally.\n"
		prompt += "Keep suggestions concise and immediately useful.\n"

		// Add context-specific hints
		if (context.document && context.range) {
			const hints = this.getContextualHints(context.document, context.range)
			if (hints) {
				prompt += "\n" + hints
			}
		}

		return prompt
	}

	/**
	 * Analyze surrounding code to provide context
	 */
	private analyzeContext(
		surrounding: { before: string; after: string; currentLine: string },
		context: Partial<GhostSuggestionContext>,
	): string {
		let analysis = "## Context Analysis\n"

		// Check what's immediately before
		const linesBefore = surrounding.before.trim().split("\n")
		const lastLine = linesBefore[linesBefore.length - 1] || ""

		if (lastLine) {
			// Check for incomplete statements
			if (this.isIncompleteStatement(lastLine)) {
				analysis += "- Previous line appears incomplete\n"
			}

			// Check for specific patterns
			if (lastLine.includes("if") || lastLine.includes("else")) {
				analysis += "- Inside conditional block\n"
			}
			if (lastLine.includes("for") || lastLine.includes("while")) {
				analysis += "- Inside loop\n"
			}
			if (lastLine.includes("function") || lastLine.includes("=>")) {
				analysis += "- Inside or after function declaration\n"
			}
			if (lastLine.includes("class")) {
				analysis += "- Inside class definition\n"
			}
			if (lastLine.includes("//") || lastLine.includes("/*")) {
				analysis += "- After comment - consider implementing described functionality\n"
			}
		}

		// Check what's immediately after
		const linesAfter = surrounding.after.trim().split("\n")
		const nextLine = linesAfter[0] || ""

		if (nextLine) {
			if (nextLine.includes("}")) {
				analysis += "- Before closing brace - might need completion\n"
			}
			if (nextLine.includes("return")) {
				analysis += "- Before return statement\n"
			}
		}

		// Check indentation level
		if (context.range && context.document) {
			const currentIndent = this.getIndentationLevel(context.document, context.range.start.line)
			analysis += `- Indentation level: ${currentIndent}\n`
		}

		analysis += "\n"
		return analysis
	}

	/**
	 * Get contextual hints based on surrounding code
	 */
	private getContextualHints(document: TextDocument, range: Range): string {
		const lineNum = range.start.line
		let hints = "### Hints:\n"

		// Check previous line
		if (lineNum > 0) {
			const prevLine = document.lineAt(lineNum - 1).text

			if (prevLine.includes("{") && !prevLine.includes("}")) {
				hints += "- Opening brace detected - add content for the block\n"
			}
			if (prevLine.match(/^\s*(if|else if|while|for|switch|try|catch)/)) {
				hints += "- Control structure detected - complete the block\n"
			}
			if (prevLine.match(/^\s*(function|const.*=.*function|.*=>\s*$)/)) {
				hints += "- Function declaration detected - add function body\n"
			}
			if (prevLine.match(/^\s*\/\//)) {
				hints += "- Comment detected - consider implementing described code\n"
			}
			if (prevLine.match(/^\s*(const|let|var)\s+\w+\s*$/)) {
				hints += "- Variable declaration without value - add initialization\n"
			}
		}

		// Check next line
		if (lineNum < document.lineCount - 1) {
			const nextLine = document.lineAt(lineNum + 1).text

			if (nextLine.includes("}")) {
				hints += "- Closing brace ahead - complete the block\n"
			}
			if (nextLine.match(/^\s*return/)) {
				hints += "- Return statement ahead - add logic before return\n"
			}
		}

		// Check if we're at the end of a function
		if (this.isNearFunctionEnd(document, lineNum)) {
			hints += "- Near function end - consider adding return statement\n"
		}

		return hints
	}

	/**
	 * Get the indentation level of a line
	 */
	private getIndentationLevel(document: TextDocument, lineNum: number): number {
		if (lineNum >= document.lineCount) return 0

		const line = document.lineAt(lineNum).text
		const match = line.match(/^(\s*)/)
		return match ? match[1].length : 0
	}

	/**
	 * Check if we're near the end of a function
	 */
	private isNearFunctionEnd(document: TextDocument, lineNum: number): boolean {
		// Simple heuristic: check if there's a closing brace within 3 lines
		for (let i = lineNum + 1; i < Math.min(lineNum + 4, document.lineCount); i++) {
			const line = document.lineAt(i).text
			if (line.includes("}")) {
				// Check if this might be a function closing brace
				// by looking for function-related keywords before
				for (let j = Math.max(0, lineNum - 10); j < lineNum; j++) {
					const prevLine = document.lineAt(j).text
					if (prevLine.match(/function|=>|\{/)) {
						return true
					}
				}
			}
		}
		return false
	}

	/**
	 * Formats recent operations for inclusion in prompts
	 */
	private formatRecentOperations(operations: any[]): string {
		if (!operations || operations.length === 0) return ""

		let result = "## Recent Actions\n"
		operations.slice(0, 5).forEach((op, index) => {
			result += `${index + 1}. ${op.description}\n`
			if (op.content) {
				result += `   \`\`\`\n   ${op.content}\n   \`\`\`\n`
			}
		})

		return result
	}

	/**
	 * Helper to check if a line appears to be incomplete
	 */
	private isIncompleteStatement(line: string): boolean {
		const trimmed = line.trim()

		// Check for common incomplete patterns
		const incompletePatterns = [
			/^(if|else if|while|for|switch|try|catch)\s*\(.*\)\s*$/, // Control structures without body
			/^(function|class|interface|type|enum)\s+\w+.*[^{]$/, // Declarations without body
			/[,\+\-\*\/\=\|\&]\s*$/, // Operators at end
			/^(const|let|var)\s+\w+\s*=\s*$/, // Variable declaration without value
			/\.\s*$/, // Property access incomplete
			/\(\s*$/, // Opening parenthesis
			/^\s*\.\w*$/, // Method chaining incomplete
		]

		return incompletePatterns.some((pattern) => pattern.test(trimmed))
	}

	/**
	 * Gets surrounding code context (lines before and after cursor)
	 */
	private getSurroundingCode(
		document: TextDocument,
		range: Range,
		linesBefore: number = 10,
		linesAfter: number = 10,
	): { before: string; after: string; currentLine: string } {
		const currentLineNum = range.start.line
		const startLine = Math.max(0, currentLineNum - linesBefore)
		const endLine = Math.min(document.lineCount - 1, currentLineNum + linesAfter)

		let before = ""
		let after = ""
		const currentLine = document.lineAt(currentLineNum).text

		// Get lines before cursor
		for (let i = startLine; i < currentLineNum; i++) {
			before += document.lineAt(i).text + "\n"
		}

		// Get lines after cursor
		for (let i = currentLineNum + 1; i <= endLine; i++) {
			after += document.lineAt(i).text + "\n"
		}

		return { before, after, currentLine }
	}
}
