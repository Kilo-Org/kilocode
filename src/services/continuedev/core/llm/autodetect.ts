import { ModelCapability } from "../index.js"
import { NEXT_EDIT_MODELS } from "./constants.js"

// NOTE: When updating this list,
// update core/nextEdit/templating/NextEditPromptEngine.ts as well.
const MODEL_SUPPORTS_NEXT_EDIT: string[] = [NEXT_EDIT_MODELS.MERCURY_CODER, NEXT_EDIT_MODELS.INSTINCT]

export function modelSupportsNextEdit(
	capabilities: ModelCapability | undefined,
	model: string,
	title: string | undefined,
): boolean {
	if (capabilities?.nextEdit !== undefined) {
		return capabilities.nextEdit
	}

	const lower = model.toLowerCase()
	if (MODEL_SUPPORTS_NEXT_EDIT.some((modelName) => lower.includes(modelName) || title?.includes(modelName))) {
		return true
	}

	return false
}
