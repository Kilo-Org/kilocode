import { GhostSuggestionContext } from "../types"
import { PromptStrategy } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
import { formatDocumentWithCursor, getBaseSystemInstructions } from "./StrategyHelpers"

export class CommentDrivenStrategy implements PromptStrategy {
	name = "Comment Driven"

	canHandle(context: GhostSuggestionContext): boolean {
		if (!context.document || !context.range) return false

		// Get the current line
		const currentLine = context.document.lineAt(context.range.start.line).text
		const trimmedLine = currentLine.trim()

		// Check if the current or previous line contains a comment
		const isComment = this.isCommentLine(trimmedLine, context.document.languageId)

		// Also check the previous line if current line is empty
		if (!isComment && trimmedLine === "" && context.range.start.line > 0) {
			const prevLine = context.document.lineAt(context.range.start.line - 1).text.trim()
			return this.isCommentLine(prevLine, context.document.languageId)
		}

		return isComment && !context.userInput // User input takes precedence
	}

	getSystemInstructions(customInstructions?: string): string {
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

	getUserPrompt(context: GhostSuggestionContext): string {
		if (!context.document || !context.range) {
			return "No context available for comment-driven generation."
		}

		const currentLine = context.range.start.line
		const document = context.document

		// Extract the comment and surrounding context
		const { comment, contextBefore, contextAfter } = this.extractCommentContext(document, currentLine)

		const language = document.languageId

		let prompt = `## Comment-Driven Development\n`
		prompt += `- Language: ${language}\n`
		prompt += `- Comment to Implement:\n\`\`\`\n${comment}\n\`\`\`\n\n`

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		prompt += `## Instructions\n`
		prompt += `Generate code that implements the functionality described in the comment.\n`
		prompt += `The code should be placed at the cursor position (${CURSOR_MARKER}).\n`
		prompt += `Focus on implementing exactly what the comment describes.\n`

		return prompt
	}

	/**
	 * Checks if a line is a comment based on language
	 */
	private isCommentLine(line: string, languageId: string): boolean {
		const trimmed = line.trim()

		// Common single-line comment patterns
		const singleLinePatterns = [
			/^\/\//, // JavaScript, TypeScript, C++, Java, etc.
			/^#/, // Python, Ruby, Shell, etc.
			/^--/, // SQL, Haskell, Lua
			/^;/, // Assembly, Lisp
			/^%/, // MATLAB, LaTeX
			/^'/, // VB
		]

		// Multi-line comment patterns
		const multiLinePatterns = [
			/^\/\*/, // C-style
			/^\*/, // Inside C-style block
			/^<!--/, // HTML, XML
			/^"""/, // Python docstring
			/^'''/, // Python docstring alternative
		]

		// Check single-line patterns
		if (singleLinePatterns.some((pattern) => pattern.test(trimmed))) {
			// Make sure it contains meaningful text (not just comment syntax)
			const withoutCommentSyntax = trimmed.replace(/^(\/\/|#|--|;|%|')\s*/, "")
			return withoutCommentSyntax.length > 0
		}

		// Check multi-line patterns
		if (multiLinePatterns.some((pattern) => pattern.test(trimmed))) {
			return true
		}

		// Language-specific checks
		switch (languageId) {
			case "python":
				return /^#/.test(trimmed) || /^("""|''')/.test(trimmed)
			case "javascript":
			case "typescript":
			case "javascriptreact":
			case "typescriptreact":
				return /^(\/\/|\/\*|\*)/.test(trimmed)
			case "html":
			case "xml":
				return /^<!--/.test(trimmed)
			case "css":
			case "scss":
			case "less":
				return /^(\/\*|\*)/.test(trimmed)
			default:
				// Default to common patterns
				return /^(\/\/|#|\/\*|\*)/.test(trimmed)
		}
	}

	/**
	 * Extracts the comment and surrounding context
	 */
	private extractCommentContext(
		document: any,
		currentLine: number,
	): { comment: string; contextBefore: string; contextAfter: string } {
		let comment = ""
		let contextBefore = ""
		let contextAfter = ""

		// Get the comment (could be multi-line)
		let commentStartLine = currentLine
		let commentEndLine = currentLine

		// Check if current line is a comment
		const currentLineText = document.lineAt(currentLine).text
		if (this.isCommentLine(currentLineText.trim(), document.languageId)) {
			comment = currentLineText.trim()

			// Check for multi-line comments above
			let line = currentLine - 1
			while (line >= 0) {
				const lineText = document.lineAt(line).text.trim()
				if (this.isCommentLine(lineText, document.languageId)) {
					comment = lineText + "\n" + comment
					commentStartLine = line
					line--
				} else {
					break
				}
			}

			// Check for multi-line comments below
			line = currentLine + 1
			while (line < document.lineCount) {
				const lineText = document.lineAt(line).text.trim()
				if (this.isCommentLine(lineText, document.languageId)) {
					comment = comment + "\n" + lineText
					commentEndLine = line
					line++
				} else {
					break
				}
			}
		} else if (currentLine > 0) {
			// Check previous line for comment
			const prevLineText = document.lineAt(currentLine - 1).text
			if (this.isCommentLine(prevLineText.trim(), document.languageId)) {
				comment = prevLineText.trim()
				commentStartLine = currentLine - 1
				commentEndLine = currentLine - 1
			}
		}

		// Get context before the comment (up to 10 lines)
		const contextStartLine = Math.max(0, commentStartLine - 10)
		for (let i = contextStartLine; i < commentStartLine; i++) {
			contextBefore += document.lineAt(i).text + "\n"
		}

		// Get context after the comment (up to 5 lines)
		const contextEndLine = Math.min(document.lineCount - 1, commentEndLine + 5)
		for (let i = commentEndLine + 1; i <= contextEndLine; i++) {
			const lineText = document.lineAt(i).text
			// Stop if we hit non-empty code
			if (lineText.trim() && !this.isCommentLine(lineText.trim(), document.languageId)) {
				contextAfter += lineText + "\n"
			}
		}

		return {
			comment: this.cleanComment(comment, document.languageId),
			contextBefore: contextBefore.trim(),
			contextAfter: contextAfter.trim(),
		}
	}

	/**
	 * Cleans comment text by removing comment syntax
	 */
	private cleanComment(comment: string, languageId: string): string {
		const lines = comment.split("\n")
		const cleaned = lines.map((line) => {
			// Remove common comment prefixes
			return line
				.replace(/^\/\/\s*/, "") // //
				.replace(/^\/\*\s*/, "") // /*
				.replace(/^\*\s*/, "") // *
				.replace(/\*\/\s*$/, "") // */
				.replace(/^#\s*/, "") // #
				.replace(/^--\s*/, "") // --
				.replace(/^;\s*/, "") // ;
				.replace(/^%\s*/, "") // %
				.replace(/^'\s*/, "") // '
				.replace(/^<!--\s*/, "") // <!--
				.replace(/-->\s*$/, "") // -->
				.trim()
		})

		return cleaned.filter((line) => line.length > 0).join("\n")
	}
}
