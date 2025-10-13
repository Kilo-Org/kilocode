import { GhostSuggestionContext } from "../types"
import { PromptStrategy } from "../types/PromptStrategy"
import { CURSOR_MARKER } from "../ghostConstants"
import { formatDocumentWithCursor, getBaseSystemInstructions } from "./StrategyHelpers"

export class AutoTriggerStrategy implements PromptStrategy {
	name = "Auto Trigger"

	canHandle(context: GhostSuggestionContext): boolean {
		// This is the fallback strategy, so it can handle anything
		// But we check for basic requirements
		return !!context.document
	}

	getSystemInstructions(customInstructions?: string): string {
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
	getUserPrompt(context: GhostSuggestionContext): string {
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
		}

		// Add the full document with cursor marker
		if (context.document) {
			prompt += "## Full Code\n"
			prompt += formatDocumentWithCursor(context.document, context.range)
			prompt += "\n\n"
		}

		// Add specific instructions
		prompt += "## Instructions\n"
		prompt += `Provide a minimal, obvious completion at the cursor position (${CURSOR_MARKER}).\n\n`

		prompt += `CRITICAL - Cursor Marker Placement:\n`
		prompt += `- Your <search> block must include ONLY the cursor marker ${CURSOR_MARKER} if adding new code\n`
		prompt += `- DO NOT include existing comment lines in your <search> block\n`
		prompt += `- If a comment describes what to implement, ADD code AFTER the comment line\n`
		prompt += `- Example: If line has "// implement function", search for just "${CURSOR_MARKER}" and add the function below\n\n`

		prompt += `General Rules:\n`
		prompt += "- Complete only what the user appears to be typing\n"
		prompt += "- Single line preferred, no new features\n"
		prompt += "- Keep existing comments, add code after them\n"
		prompt += "- If nothing obvious to complete, provide NO suggestion\n"

		return prompt
	}
}
