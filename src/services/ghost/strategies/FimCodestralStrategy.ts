import { GhostSuggestionContext } from "../types"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
import { rankSnippets } from "../context/ContextRanking"
import { getBaseSystemInstructions } from "./StrategyHelpers"

/**
 * Strategy using Fill-In-the-Middle (FIM) format for Codestral
 * Uses the [SUFFIX][PREFIX] format optimized for Mistral Codestral models
 *
 * This strategy implements the FIM prompt template with special [SUFFIX] and [PREFIX] markers
 * that Codestral models are trained to understand for code completion.
 */
export class FimCodestralStrategy implements PromptStrategy {
	name = "FIM Codestral"
	type = UseCaseType.FIM_CODESTRAL

	canHandle(_context: GhostSuggestionContext): boolean {
		// This strategy can handle all cases when explicitly selected
		// In production, you'd add specific logic here
		return false // We will enable in the next PR -- 2025-10-09
	}

	getSystemInstructions(customInstructions?: string): string {
		return (
			getBaseSystemInstructions() +
			`You are an AI assistant specialized in code completion using Fill-In-the-Middle (FIM) format.

## FIM Format Understanding
The user prompt follows the Codestral FIM format:
- [SUFFIX] marker followed by code that comes AFTER the cursor
- [PREFIX] marker followed by code that comes BEFORE the cursor
- The ${CURSOR_MARKER} marker indicates the exact cursor position

## Your Task
Generate code to fill in at the cursor position. The code should:
1. Fit naturally between the prefix and suffix
2. Follow the existing code style and patterns
3. Be syntactically correct
4. Complete the intended functionality
5. Be minimal - only complete what's necessary

## Important Rules
1. Your <search> block MUST include the ${CURSOR_MARKER} marker
2. Include sufficient context around the cursor to uniquely identify the location
3. The <replace> block should contain the complete text including your completion
4. Generate only ONE <change> block
5. Focus on the immediate completion need
6. Consider common code patterns and idioms
7. Maintain consistency with surrounding code`
		)
	}

	getUserPrompt(context: GhostSuggestionContext): string {
		if (!context.document || !context.range) {
			return "No context available for completion."
		}
    
    // Get recent operations for additional context (from existing system)
		const recentOpsContext = this.getRecentOperationsContext(context)

		const document = context.document
		const position = context.range.start

 		// FIXME: use addCursorMarker from StrategyHelpers.ts
		// Get the code before and after the cursor
		const fullText = document.getText()
		const offset = document.offsetAt(position)
		const textBeforeCursor = fullText.substring(0, offset)
		const textAfterCursor = fullText.substring(offset)

		return `[SUFFIX]${textAfterCursor}[PREFIX]${recentOpsContext}${textBeforeCursor}${CURSOR_MARKER}`
	}

	/**
	 * Get recent operations as context string from existing GhostDocumentStore
	 * Uses Jaccard similarity ranking to prioritize most relevant operations
	 */
	private getRecentOperationsContext(context: GhostSuggestionContext): string {
		if (!context.document || !context.range) {
			return ""
		}

		// Get window around cursor for similarity comparison
		const position = context.range.start
		const windowSize = 500 // characters before and after cursor

		const textBeforeCursor = context.document.getText(
			new (context.range.constructor as any)(
				new (position.constructor as any)(Math.max(0, position.line - 5), 0),
				position,
			),
		)
		const textAfterCursor = context.document.getText(
			new (context.range.constructor as any)(
				position,
				new (position.constructor as any)(Math.min(position.line + 5, context.document.lineCount), 0),
			),
		)
		const windowAroundCursor = textBeforeCursor + textAfterCursor

		// Collect all operations with their content
		const allOperations: Array<{ content: string; filepath: string; description: string; isGlobal: boolean }> = []

		// Add current file operations
		if (context.recentOperations && context.recentOperations.length > 0) {
			context.recentOperations.forEach((op) => {
				if (op.content) {
					allOperations.push({
						content: op.content,
						filepath: context.document!.uri.toString(),
						description: op.description,
						isGlobal: false,
					})
				}
			})
		}

		// Add global operations from other files
		if (context.globalRecentOperations && context.globalRecentOperations.length > 0) {
			context.globalRecentOperations.forEach((op) => {
				if (op.content) {
					allOperations.push({
						content: op.content,
						filepath: op.filepath,
						description: op.description,
						isGlobal: true,
					})
				}
			})
		}

		if (allOperations.length === 0) {
			return ""
		}

		// Rank operations by similarity to code around cursor
		const rankedOps = rankSnippets(
			allOperations.map((op) => ({
				content: op.content,
				filepath: op.filepath,
			})),
			windowAroundCursor,
		)

		// Take top 3 most relevant operations
		const topOperations = rankedOps.slice(0, 3)

		// Format with descriptions
		const contextParts = topOperations.map((ranked) => {
			const op = allOperations.find((o) => o.content === ranked.content && o.filepath === ranked.filepath)
			if (!op) return ""

			if (op.isGlobal) {
				const filename = op.filepath.split("/").pop() || op.filepath
				return `// Recent in ${filename}: ${op.description} (relevance: ${(ranked.score * 100).toFixed(0)}%)\n${ranked.content}`
			} else {
				return `// Recent: ${op.description} (relevance: ${(ranked.score * 100).toFixed(0)}%)\n${ranked.content}`
			}
		})

		return contextParts.length > 0 ? `${contextParts.filter(Boolean).join("\n\n")}\n\n` : ""
	}
}
