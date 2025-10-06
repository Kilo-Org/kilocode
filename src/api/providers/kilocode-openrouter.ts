import { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { CompletionUsage, OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../transform/model-params"
import { getModels } from "./fetchers/modelCache"
import { DEEP_SEEK_DEFAULT_TEMPERATURE, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@roo-code/types"
import { getKiloBaseUriFromToken } from "../../shared/kilocode/token"
import { ApiHandlerCreateMessageMetadata } from ".."
import { getModelEndpoints } from "./fetchers/modelEndpointCache"
import { getKilocodeDefaultModel } from "./kilocode/getKilocodeDefaultModel"
import { X_KILOCODE_ORGANIZATIONID, X_KILOCODE_TASKID, X_KILOCODE_TESTER } from "../../shared/kilocode/headers"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information and fetches models from the KiloCode OpenRouter endpoint.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	protected override models: ModelRecord = {}
	defaultModel: string = openRouterDefaultModelId

	protected override get providerName() {
		return "KiloCode"
	}

	constructor(options: ApiHandlerOptions) {
		const baseUri = getKiloBaseUriFromToken(options.kilocodeToken ?? "")
		options = {
			...options,
			openRouterBaseUrl: `${baseUri}/api/openrouter/`,
			openRouterApiKey: options.kilocodeToken,
		}

		super(options)
	}

	override customRequestOptions(metadata?: ApiHandlerCreateMessageMetadata) {
		const headers: Record<string, string> = {}

		if (metadata?.taskId) {
			headers[X_KILOCODE_TASKID] = metadata.taskId
		}

		const kilocodeOptions = this.options

		if (kilocodeOptions.kilocodeOrganizationId) {
			headers[X_KILOCODE_ORGANIZATIONID] = kilocodeOptions.kilocodeOrganizationId
		}

		// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
		if (
			kilocodeOptions.kilocodeTesterWarningsDisabledUntil &&
			kilocodeOptions.kilocodeTesterWarningsDisabledUntil > Date.now()
		) {
			headers[X_KILOCODE_TESTER] = "SUPPRESS"
		}

		return Object.keys(headers).length > 0 ? { headers } : undefined
	}

	override getTotalCost(lastUsage: CompletionUsage): number {
		const model = this.getModel().info
		if (!model.inputPrice && !model.outputPrice) {
			return 0
		}
		// https://github.com/Kilo-Org/kilocode-backend/blob/eb3d382df1e933a089eea95b9c4387db0c676e35/src/lib/processUsage.ts#L281
		if (lastUsage.is_byok) {
			return lastUsage.cost_details?.upstream_inference_cost || 0
		}
		return lastUsage.cost || 0
	}

	override getModel() {
		const id = this.options.kilocodeModel ?? this.defaultModel
		let info = this.models[id] ?? openRouterDefaultModelInfo

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
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	public override async fetchModel() {
		if (!this.options.kilocodeToken || !this.options.openRouterBaseUrl) {
			throw new Error("KiloCode token + baseUrl is required to fetch models")
		}

		const [models, endpoints, defaultModel] = await Promise.all([
			getModels({
				provider: "kilocode-openrouter",
				kilocodeToken: this.options.kilocodeToken,
				kilocodeOrganizationId: this.options.kilocodeOrganizationId,
			}),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.kilocodeModel,
				endpoint: this.options.openRouterSpecificProvider,
			}),
			getKilocodeDefaultModel(this.options.kilocodeToken, this.options.kilocodeOrganizationId, this.options),
		])

		this.models = models
		this.endpoints = endpoints
		this.defaultModel = defaultModel
		return this.getModel()
	}
}
