import { getModelParams } from ".."
import { ApiHandlerOptions, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { DEEP_SEEK_DEFAULT_TEMPERATURE } from "./constants"
import { OpenRouterHandler } from "./openrouter"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information.
 */
export class CustomOpenRouterHandler extends OpenRouterHandler {
	constructor(options: ApiHandlerOptions) {
		super(options)
	}

	/**
	 * Override the getModel function to provide custom model information
	 */
	override getModel() {
		console.log("CustomOpenRouterHandler getModel called")

		// Default values from OpenRouter
		let id = openRouterDefaultModelId
		let info = openRouterDefaultModelInfo
		let defaultTemperature = 0
		let topP = undefined

		const selectedModel = this.options.kilocodeModel

		// TODO: use the models that have been fetched from openrouter.
		// for now we are using the hardcoded models
		if (selectedModel === "claude37") {
			id = "anthropic/claude-3.7-sonnet"
			info = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsComputerUse: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet via OpenRouter",
				thinking: false,
			}
		} else if (selectedModel === "gemini25") {
			id = "google/gemini-2.5-pro-preview-03-25"
			info = {
				maxTokens: 65_536,
				contextWindow: 1_000_000,
				supportsImages: true,
				supportsComputerUse: true,
				supportsPromptCache: true,
				inputPrice: 1.25,
				outputPrice: 10,
				description: "Gemini 2.5 Pro via OpenRouter",
			}
		}

		return {
			id,
			info,
			...getModelParams({ options: this.options, model: info, defaultTemperature }),
			topP,
		}
	}
}
