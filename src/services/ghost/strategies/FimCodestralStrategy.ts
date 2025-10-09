import { GhostSuggestionContext } from "../types"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
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

		const document = context.document
		const position = context.range.start

		// FIXME: use addCursorMarker from StrategyHelpers.ts
		// Get the code before and after the cursor
		const fullText = document.getText()
		const offset = document.offsetAt(position)
		const textBeforeCursor = fullText.substring(0, offset)
		const textAfterCursor = fullText.substring(offset)

		return `[SUFFIX]${textAfterCursor}[PREFIX]${textBeforeCursor}${CURSOR_MARKER}`
	}
}
