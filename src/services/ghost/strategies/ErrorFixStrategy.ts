import * as vscode from "vscode"
import { GhostSuggestionContext } from "../types"
import { UseCaseType } from "../types/PromptStrategy"
import { BasePromptStrategy } from "./BasePromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"

/**
 * Strategy for fixing compilation errors and warnings
 * handles diagnostics when no explicit user request
 */
export class ErrorFixStrategy extends BasePromptStrategy {
	name = "Error Fix"
	type = UseCaseType.ERROR_FIX

	/**
	 * Focus on diagnostics and code structure
	 * Exclude user input and recent operations
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			diagnostics: context.diagnostics,
			range: context.range,
			rangeASTNode: context.rangeASTNode,
			// Exclude:
			// - userInput (no explicit request)
			// - recentOperations (not relevant for error fixing)
			// - openFiles (reduces tokens)
		}
	}

	/**
	 * System instructions for error fixing
	 */
	protected getSpecificSystemInstructions(): string {
		return `Task: Fix Compilation Errors and Warnings
Your goal is to resolve diagnostics (errors and warnings) in the code with minimal, targeted fixes.

Priority Order:
1. Fix compilation errors (blocking issues)
2. Fix type errors
3. Address warnings
4. Maintain existing functionality

Fix Guidelines:
- Make minimal changes to resolve issues
- Don't refactor unless necessary for the fix
- Preserve original code intent and style
- Add imports if missing
- Fix one issue at a time if they're unrelated
- Don't introduce new features or improvements

Common Error Patterns:
- Missing semicolon → add semicolon
- Undefined variable → add declaration or import
- Type mismatch → fix type or cast appropriately
- Missing return → add return statement
- Unused variable → remove or use the variable
- Missing property → add property or optional chaining
- Syntax error → fix syntax while preserving intent

Important:
- Focus on the specific lines mentioned in diagnostics
- If multiple errors are related, fix them together
- If errors cascade (one causes others), fix the root cause`
	}

	/**
	 * Build prompt focused on diagnostics
	 */
	protected buildUserPrompt(context: Partial<GhostSuggestionContext>): string {
		let prompt = ""

		// Start with diagnostics - they're the main focus
		if (context.diagnostics && context.diagnostics.length > 0) {
			prompt += "## Diagnostics to Fix\n"

			// Sort by severity (errors first) and then by line number
			const sorted = [...context.diagnostics].sort((a, b) => {
				if (a.severity !== b.severity) {
					return a.severity - b.severity
				}
				return a.range.start.line - b.range.start.line
			})

			// Group diagnostics by line for better context
			const diagnosticsByLine = new Map<number, vscode.Diagnostic[]>()
			sorted.forEach((d) => {
				const line = d.range.start.line
				if (!diagnosticsByLine.has(line)) {
					diagnosticsByLine.set(line, [])
				}
				diagnosticsByLine.get(line)!.push(d)
			})

			// Format diagnostics with code context
			diagnosticsByLine.forEach((diagnostics, lineNum) => {
				const lineNumber = lineNum + 1
				prompt += `\n### Line ${lineNumber}:\n`

				// Add the actual line of code if available
				if (context.document) {
					const lineText = context.document.lineAt(lineNum).text
					prompt += `Code: \`${lineText.trim()}\`\n`
				}

				// List all diagnostics for this line
				diagnostics.forEach((d) => {
					const severity = vscode.DiagnosticSeverity[d.severity]
					prompt += `- **${severity}**: ${d.message}`

					// Add diagnostic code if available (helps identify the type of error)
					if (d.code) {
						prompt += ` (${d.code})`
					}
					prompt += "\n"
				})
			})

			prompt += "\n"
		}

		// Add AST context if available
		if (context.rangeASTNode) {
			prompt += this.formatASTContext(context.rangeASTNode)
			prompt += "This can help you understand the code structure around the errors.\n\n"
		}

		// Add cursor position context
		if (context.range && context.document) {
			const line = context.range.start.line + 1
			const char = context.range.start.character + 1
			prompt += `## Cursor Position\n`
			prompt += `Line ${line}, Character ${char}\n\n`
		}

		// Add the full code
		if (context.document) {
			prompt += "## Code with Errors\n"
			prompt += this.formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += "Fix the diagnostics listed above with minimal changes.\n"
		prompt += "Priority: Errors > Warnings\n"

		if (context.range) {
			prompt += `Focus on fixes near the cursor position (${CURSOR_MARKER}).\n`
		}

		// Count errors vs warnings
		const errorCount =
			context.diagnostics?.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length || 0
		const warningCount =
			context.diagnostics?.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length || 0

		if (errorCount > 0) {
			prompt += `\nYou have ${errorCount} error${errorCount > 1 ? "s" : ""} that must be fixed.\n`
		}
		if (warningCount > 0) {
			prompt += `You have ${warningCount} warning${warningCount > 1 ? "s" : ""} that should be addressed.\n`
		}

		// Add hints based on common error patterns
		if (context.diagnostics) {
			const messages = context.diagnostics.map((d) => d.message.toLowerCase())

			if (messages.some((m) => m.includes("cannot find") || m.includes("undefined"))) {
				prompt += "\nHint: Some errors involve undefined symbols - check for missing imports or declarations.\n"
			}
			if (messages.some((m) => m.includes("type"))) {
				prompt +=
					"Hint: Type errors detected - ensure type compatibility and consider type assertions if needed.\n"
			}
			if (messages.some((m) => m.includes("expected"))) {
				prompt += "Hint: Syntax errors detected - check for missing punctuation or incorrect syntax.\n"
			}
		}

		return prompt
	}

	/**
	 * Helper to check if all diagnostics are just warnings
	 */
	private hasOnlyWarnings(diagnostics: vscode.Diagnostic[]): boolean {
		return diagnostics.every((d) => d.severity === vscode.DiagnosticSeverity.Warning)
	}

	/**
	 * Can handle contexts with errors or warnings
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		// Primary: handle if there are errors
		const hasErrors = context.diagnostics?.some((d) => d.severity === vscode.DiagnosticSeverity.Error) || false

		if (hasErrors) {
			return true
		}

		// Secondary: handle warnings if no user input
		if (!context.userInput && context.diagnostics && context.diagnostics.length > 0) {
			return this.hasOnlyWarnings(context.diagnostics)
		}

		return false
	}
}
