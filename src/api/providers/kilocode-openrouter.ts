import { ApiHandlerOptions, PROMPT_CACHING_MODELS, OPTIONAL_PROMPT_CACHING_MODELS, ModelRecord } from "../../shared/api"
import { OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../getModelParams"
import { getModels } from "./fetchers/cache"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information and fetches models from the KiloCode OpenRouter endpoint.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	protected override models: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		const baseUri = getKiloBaseUri(options)
		options = {
			...options,
			openRouterBaseUrl: `${baseUri}/api/openrouter/`,
			openRouterApiKey: options.kilocodeToken,
		}

		super(options)
	}

	override getModel() {
		let id
		let info
		let defaultTemperature = 0
		let topP = undefined

		const selectedModel = this.options.kilocodeModel ?? "gemini25"

		// Map the selected model to the corresponding OpenRouter model ID
		// legacy mapping
		const modelMapping = {
			gemini25: "google/gemini-2.5-pro-preview",
			gpt41: "openai/gpt-4.1",
			gemini25flashpreview: "google/gemini-2.5-flash-preview",
			claude37: "anthropic/claude-3.7-sonnet",
		}

		// check if the selected model is in the mapping for backwards compatibility
		id = selectedModel
		if (Object.keys(modelMapping).includes(selectedModel)) {
			id = modelMapping[selectedModel as keyof typeof modelMapping]
		}

		if (this.models[id]) {
			info = this.models[id]
		} else {
			throw new Error(`Unsupported model: ${selectedModel}`)
		}

		return {
			id,
			info,
			...getModelParams({ options: this.options, model: info, defaultTemperature }),
			topP,
			promptCache: {
				supported: PROMPT_CACHING_MODELS.has(id),
				optional: OPTIONAL_PROMPT_CACHING_MODELS.has(id),
			},
		}
	}

	public override async fetchModel() {
		this.models = await getModels("kilocode-openrouter")
		return this.getModel()
	}
}

function getKiloBaseUri(options: ApiHandlerOptions) {
	try {
		const token = options.kilocodeToken as string
		const payload_string = token.split(".")[1]
		const payload = JSON.parse(Buffer.from(payload_string, "base64").toString())
		//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
		if (payload.env === "development") return "http://localhost:3000"
	} catch (_error) {
		console.warn("Failed to get base URL from Kilo Code token")
	}
	return "https://kilocode.ai"
}
