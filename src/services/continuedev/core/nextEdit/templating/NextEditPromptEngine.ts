import { NEXT_EDIT_MODELS } from "../../llm/constants"
import {
	INSTINCT_USER_PROMPT_PREFIX,
	MERCURY_CURRENT_FILE_CONTENT_CLOSE,
	MERCURY_CURRENT_FILE_CONTENT_OPEN,
	MERCURY_EDIT_DIFF_HISTORY_CLOSE,
	MERCURY_EDIT_DIFF_HISTORY_OPEN,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN,
} from "../constants"
import { NextEditTemplateRenderer } from "../providers/InstinctNextEditProvider"
import { TemplateVars } from "../types"

// Keep the template registry
export const NEXT_EDIT_MODEL_TEMPLATES: Record<NEXT_EDIT_MODELS, NextEditTemplateRenderer> = {
	"mercury-coder": (vars: TemplateVars) =>
		`${MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN}\n${vars.recentlyViewedCodeSnippets ?? ""}\n${MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE}\n\n${MERCURY_CURRENT_FILE_CONTENT_OPEN}\n${vars.currentFileContent ?? ""}\n${MERCURY_CURRENT_FILE_CONTENT_CLOSE}\n\n${MERCURY_EDIT_DIFF_HISTORY_OPEN}\n${vars.editDiffHistory ?? ""}\n${MERCURY_EDIT_DIFF_HISTORY_CLOSE}\n`,
	instinct: (vars: TemplateVars) =>
		`${INSTINCT_USER_PROMPT_PREFIX}\n\n### Context:\n${vars.contextSnippets ?? ""}\n\n### User Edits:\n\n${vars.editDiffHistory ?? ""}\n\n### User Excerpt:\n${vars.currentFilePath ?? ""}\n\n${vars.currentFileContent ?? ""}\`\`\`\n### Response:`,
}

// Keep for backward compatibility or remove if not needed
export function getTemplateForModel(modelName: NEXT_EDIT_MODELS): NextEditTemplateRenderer {
	const template = NEXT_EDIT_MODEL_TEMPLATES[modelName]
	if (!template) {
		throw new Error(`Model ${modelName} is not supported for next edit.`)
	}
	return template
}
