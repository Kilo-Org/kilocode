import { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { CompletionUsage, OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../transform/model-params"
import { getModels } from "./fetchers/modelCache"
import {
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	kilocodeDefaultModelId,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
} from "@roo-code/types"
import { getKiloBaseUriFromToken } from "../../utils/kilocode-token"
import { ApiHandlerCreateMessageMetadata } from ".."
import OpenAI from "openai"
import { getModelEndpoints } from "./fetchers/modelEndpointCache"

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

	override customRequestOptions(metadata?: ApiHandlerCreateMessageMetadata): OpenAI.RequestOptions | undefined {
		return metadata
			? {
					headers: {
						"X-KiloCode-TaskId": metadata.taskId,
					},
				}
			: undefined
	}

	override getTotalCost(lastUsage: CompletionUsage): number {
		// https://github.com/Kilo-Org/kilocode-backend/blob/eb3d382df1e933a089eea95b9c4387db0c676e35/src/lib/processUsage.ts#L281
		if (lastUsage.is_byok) {
			return lastUsage.cost_details?.upstream_inference_cost || 0
		}
		return lastUsage.cost || 0
	}

	override getModel() {
		let id = this.options.kilocodeModel ?? kilocodeDefaultModelId
		let info = this.models[id]
		let defaultTemperature = 0

		if (!this.models[id]) {
			id = openRouterDefaultModelId
			info = openRouterDefaultModelInfo
		}

		// If a specific provider is requested, use the endpoint for that provider.
		if (this.options.openRouterSpecificProvider && this.endpoints[this.options.openRouterSpecificProvider]) {
			info = this.endpoints[this.options.openRouterSpecificProvider]
		}

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : defaultTemperature,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	public override async fetchModel() {
		if (!this.options.kilocodeToken || !this.options.openRouterBaseUrl) {
			throw new Error("KiloCode token + baseUrl is required to fetch models")
		}

		const [models, endpoints] = await Promise.all([
			getModels({
				provider: "kilocode-openrouter",
				kilocodeToken: this.options.kilocodeToken,
			}),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.kilocodeModel,
				endpoint: this.options.openRouterSpecificProvider,
			}),
		])

		this.models = models
		this.endpoints = endpoints
		return this.getModel()
	}
}

function getKiloBaseUri(options: ApiHandlerOptions) {
	return getKiloBaseUriFromToken(options.kilocodeToken ?? "")
}
