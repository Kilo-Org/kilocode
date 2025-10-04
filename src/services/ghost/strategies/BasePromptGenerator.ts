import type { TextDocument, Range, Diagnostic } from "vscode"
import { GhostSuggestionContext } from "../types"
import { PromptGenerator as PromptGenerator, UseCaseType } from "../types/PromptGenerator"
import { CURSOR_MARKER } from "../ghostConstants"
import { DiagnosticSeverityNames } from "./diagnostics"

/**
 * Abstract base class for all prompt strategies
 * Provides common functionality and enforces consistent structure
 */
export abstract class BasePromptGenerator implements PromptGenerator {
	/**
	 * Human-readable name of the strategy
	 */
	abstract name: string

	/**
	 * The use case type this strategy handles
	 */
	abstract type: UseCaseType

	/**
	 * Determines if this strategy can handle the given context
	 */
	abstract canHandle(context: GhostSuggestionContext): boolean

	/**
	 * Filters the context to only include relevant fields for this strategy
	 */
	abstract getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext>

	/**
	 * Generates system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string {
		const baseInstructions = this.getBaseSystemInstructions()
		const specificInstructions = this.getSpecificSystemInstructions()

		return `${baseInstructions}\n\n---\n\n${specificInstructions}${
			customInstructions ? `\n\n---\n\n${customInstructions}` : ""
		}`
	}

	/**
	 * Gets the base system instructions that apply to all strategies
	 */
	protected getBaseSystemInstructions(): string {
		return `CRITICAL OUTPUT FORMAT:
You must respond with XML-formatted changes ONLY. No explanations or text outside XML tags.

Format: <change><search><![CDATA[exact_code]]></search><replace><![CDATA[new_code]]></replace></change>

MANDATORY XML STRUCTURE RULES:
- Every <change> tag MUST have a closing </change> tag
- Every <search> tag MUST have a closing </search> tag
- Every <replace> tag MUST have a closing </replace> tag
- Every <![CDATA[ MUST have a closing ]]>
- XML tags should be properly formatted and nested
- Multiple <change> blocks allowed for different modifications

CHANGE ORDERING PRIORITY:
- CRITICAL: Order all <change> blocks by proximity to the cursor marker (<<<AUTOCOMPLETE_HERE>>>)
- Put changes closest to the cursor marker FIRST in your response
- This allows immediate display of the most relevant suggestions to the user
- Changes further from the cursor should come later in the response
- Measure proximity by line distance from the cursor marker position

CONTENT MATCHING RULES:
- Search content must match EXACTLY (including whitespace, indentation, and line breaks)
- Use CDATA wrappers for all code content
- Preserve all line breaks and formatting within CDATA sections
- Never generate overlapping changes
- The <search> block must contain exact text that exists in the code
- If you can't find exact match, don't generate that change

EXAMPLE:
<change><search><![CDATA[function example() {
	 // old code
}]]></search><replace><![CDATA[function example() {
	 // new code
}]]></replace></change>`
	}

	/**
	 * Gets strategy-specific system instructions
	 * Must be implemented by each strategy
	 */
	protected abstract getSpecificSystemInstructions(): string

	/**
	 * Generates the user prompt with context
	 */
	getUserPrompt(context: GhostSuggestionContext): string {
		const relevantContext = this.getRelevantContext(context)
		return this.buildUserPrompt(relevantContext)
	}

	/**
	 * Builds the user prompt from the relevant context
	 * Must be implemented by each strategy
	 */
	protected abstract buildUserPrompt(context: Partial<GhostSuggestionContext>): string

	/**
	 * Adds the cursor marker to the document text at the specified position
	 */
	protected addCursorMarker(document: TextDocument, range?: Range): string {
		if (!range) return document.getText()

		const fullText = document.getText()
		const cursorOffset = document.offsetAt(range.start)
		const beforeCursor = fullText.substring(0, cursorOffset)
		const afterCursor = fullText.substring(cursorOffset)

		return `${beforeCursor}${CURSOR_MARKER}${afterCursor}`
	}

	/**
	 * Formats diagnostics for inclusion in prompts
	 */
	protected formatDiagnostics(diagnostics: Diagnostic[]): string {
		if (!diagnostics || diagnostics.length === 0) return ""

		let result = "## Active Issues\n"

		// Sort by severity (errors first)
		const sorted = [...diagnostics].sort((a, b) => a.severity - b.severity)

		sorted.forEach((d) => {
			const severity = DiagnosticSeverityNames[d.severity] || "Unknown"
			const line = d.range.start.line + 1
			result += `- **${severity}** at line ${line}: ${d.message}\n`
		})

		return result
	}

	/**
	 * Gets surrounding code context (lines before and after cursor)
	 */
	protected getSurroundingCode(
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

	/**
	 * Formats the document with cursor marker for the prompt
	 */
	protected formatDocumentWithCursor(document: TextDocument, range?: Range, languageId?: string): string {
		const lang = languageId || document.languageId
		const codeWithCursor = this.addCursorMarker(document, range)

		return `\`\`\`${lang}
${codeWithCursor}
\`\`\``
	}

	/**
	 * Gets the file path from the document
	 */
	protected getFilePath(document: TextDocument): string {
		return document.uri.toString()
	}

	/**
	 * Formats selected text for inclusion in prompts
	 */
	protected formatSelectedText(document: TextDocument, range: Range): string {
		if (range.isEmpty) return ""

		const selectedText = document.getText(range)
		const startLine = range.start.line + 1
		const endLine = range.end.line + 1

		return `## Selected Code (Lines ${startLine}-${endLine})
\`\`\`${document.languageId}
${selectedText}
\`\`\``
	}

	/**
	 * Formats recent operations for inclusion in prompts
	 */
	protected formatRecentOperations(operations: any[]): string {
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
	 * Formats AST information for inclusion in prompts
	 */
	protected formatASTContext(node: any): string {
		if (!node) return ""

		let result = "## AST Context\n"
		result += `- Current Node: \`${node.type}\`\n`

		if (node.parent) {
			result += `- Parent Node: \`${node.parent.type}\`\n`
		}

		// Calculate nesting level
		let level = 0
		let current = node
		while (current.parent) {
			level++
			current = current.parent
		}
		result += `- Nesting Level: ${level}\n`

		return result
	}

	/**
	 * Helper to check if a line appears to be incomplete
	 */
	protected isIncompleteStatement(line: string): boolean {
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
}
