import {
	ApiHandlerOptions,
	PROMPT_CACHING_MODELS,
	OPTIONAL_PROMPT_CACHING_MODELS,
	ModelInfo,
	ModelRecord,
} from "../../shared/api"
import { OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../getModelParams"
import { getModels } from "./fetchers/cache"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information and fetches models from the KiloCode OpenRouter endpoint.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	private fetchedModels: Record<string, ModelInfo & { preferred?: boolean }> = {}
	private modelsFetched = false

	constructor(options: ApiHandlerOptions) {
		const baseUri = getKiloBaseUri(options)
		const options = {
			...options,
			openRouterBaseUrl: `${baseUri}/api/openrouter/`,
			openRouterApiKey: options.kilocodeToken,
		}

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

		// Map the selected model to the corresponding OpenRouter model ID
		// legacy mapping
		const modelMapping = {
			gemini25: "google/gemini-2.5-pro-preview-03-25",
			gpt41: "openai/gpt-4.1",
			gemini25flashpreview: "google/gemini-2.5-flash-preview",
			claude37: "anthropic/claude-3.7-sonnet",
		}

		id = modelMapping[selectedModel] || modelMapping["gemini25"]

		// Only use fetched models
		if (this.modelsFetched && Object.keys(this.fetchedModels).length > 0 && this.fetchedModels[id]) {
			info = this.fetchedModels[id]
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
		const models = await getModels("kilocode-openrouter")
		this.models = await this.sortModels(models)

		return this.getModel()
	}

	/**
	 * Get all available models, sorted with preferred models first
	 */
	async sortModels(models: ModelRecord): Promise<ModelRecord> {
		// Sort the models with preferred models first
		const sortedModels: Record<string, ModelInfo> = {}

		// First add preferred models, sorted by preferredIndex
		Object.entries(models)
			.filter(([_, model]) => model.preferredIndex !== undefined)
			.sort(([_, modelA], [__, modelB]) => {
				// Sort by preferredIndex (lower index first)
				return (modelA.preferredIndex || 0) - (modelB.preferredIndex || 0) // || 0 to satisfy TS
			})
			.forEach(([id, model]) => {
				sortedModels[id] = { ...model }
			})

		// Then add non-preferred models
		Object.entries(models)
			.filter(([_, model]) => model.preferredIndex === undefined)
			.forEach(([id, model]) => {
				// Set preferred flag to false for models without preferredIndex
				sortedModels[id] = { ...model }
			})

		return sortedModels
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
