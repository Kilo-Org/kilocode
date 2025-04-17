import { ApiHandlerOptions } from "../../shared/api"
import { OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../getModelParams"
import { kilocodeOpenrouterModels } from "../../shared/kilocode/api"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	constructor(options: ApiHandlerOptions) {
		super(options)
	}

	/**
	 * Override the getModel function to provide custom model information
	 */
	override getModel() {
		let id
		let info
		let defaultTemperature = 0
		let topP = undefined

		const selectedModel = this.options.kilocodeModel ?? "gemini25"

		// TODO: use the models that have been fetched from openrouter.
		// for now we are using the hardcoded models
		// when updating, be sure to also update 'normalizeApiConfiguration' in ApiOptions.tsx
		// because frontend needs to display the proper model
		if (selectedModel === "gemini25") {
			id = "google/gemini-2.5-pro-preview-03-25"
			info = kilocodeOpenrouterModels["google/gemini-2.5-pro-preview-03-25"]
		} else if (selectedModel === "gpt41") {
			id = "openai/gpt-4.1"
			info = kilocodeOpenrouterModels["openai/gpt-4.1"]
		} else if (selectedModel === "gemini25flashpreview") {
			id = "google/gemini-2.5-flash-preview"
			info = kilocodeOpenrouterModels["google/gemini-2.5-flash-preview"]
		} else {
			throw new Error(`Unsupported model: ${selectedModel}`)
		}

		return {
			id,
			info,
			...getModelParams({ options: this.options, model: info, defaultTemperature }),
			topP,
		}
	}
}
