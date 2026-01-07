import crypto from "crypto"
import { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { OpenRouterHandler } from "./openrouter"
import type { CompletionUsage } from "./openrouter"
import { getModelParams } from "../transform/model-params"
import { getModels } from "./fetchers/modelCache"
import { DEEP_SEEK_DEFAULT_TEMPERATURE, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@roo-code/types"
import { getKiloUrlFromToken } from "@roo-code/types"
import type { ApiHandlerCreateMessageMetadata } from ".."
import { getModelEndpoints } from "./fetchers/modelEndpointCache"
import { getKilocodeDefaultModel } from "./kilocode/getKilocodeDefaultModel"
import {
	X_KILOCODE_ORGANIZATIONID,
	X_KILOCODE_TASKID,
	X_KILOCODE_PROJECTID,
	X_KILOCODE_TESTER,
	X_KILOCODE_EDITORNAME,
} from "../../shared/kilocode/headers"
import { KILOCODE_TOKEN_REQUIRED_ERROR } from "../../shared/kilocode/errorUtils"
import { DEFAULT_HEADERS } from "./constants"
import { streamSse } from "../../services/continuedev/core/fetch/stream"
import { getEditorNameHeader } from "../../core/kilocode/wrapper"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information and fetches models from the KiloCode OpenRouter endpoint.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	protected override models: ModelRecord = {}
	defaultModel: string = openRouterDefaultModelId
	private apiFIMBase: string

	protected override get providerName() {
		return "KiloCode" as const
	}

	constructor(options: ApiHandlerOptions) {
		const baseApiUrl = getKiloUrlFromToken("https://api.kilo.ai/api/", options.kilocodeToken ?? "")

		options = {
			...options,
			openRouterBaseUrl: `${baseApiUrl}openrouter/`,
			openRouterApiKey: options.kilocodeToken,
		}

		super(options)

		this.apiFIMBase = baseApiUrl
	}

	public getRolloutHash(): number | undefined {
		const token = this.options.kilocodeToken
		return !token ? undefined : crypto.createHash("sha256").update(token).digest().readUInt32BE(0)
	}

	override customRequestOptions(metadata?: ApiHandlerCreateMessageMetadata) {
		const headers: Record<string, string> = {
			[X_KILOCODE_EDITORNAME]: getEditorNameHeader(),
		}

		if (metadata?.taskId) {
			headers[X_KILOCODE_TASKID] = metadata.taskId
		}

		const kilocodeOptions = this.options

		if (kilocodeOptions.kilocodeOrganizationId) {
			headers[X_KILOCODE_ORGANIZATIONID] = kilocodeOptions.kilocodeOrganizationId

			if (metadata?.projectId) {
				headers[X_KILOCODE_PROJECTID] = metadata.projectId
			}
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
		let id = this.options.kilocodeModel ?? this.defaultModel
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
			throw new Error(KILOCODE_TOKEN_REQUIRED_ERROR)
		}

		const [models, endpoints, defaultModel] = await Promise.all([
			getModels({
				provider: "kilocode",
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

	supportsFim(): boolean {
		const modelId = this.options.kilocodeModel ?? this.defaultModel
		return modelId.includes("codestral")
	}

	async completeFim(prefix: string, suffix: string, taskId?: string): Promise<string> {
		let result = ""
		for await (const chunk of this.streamFim(prefix, suffix, taskId)) {
			result += chunk
		}
		return result
	}

	async *streamFim(
		prefix: string,
		suffix: string,
		taskId?: string,
		onUsage?: (usage: CompletionUsage) => void,
	): AsyncGenerator<string> {
		const model = await this.fetchModel()
		const endpoint = new URL("fim/completions", this.apiFIMBase)

		// Build headers using customRequestOptions for consistency
		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			"Content-Type": "application/json",
			Accept: "application/json",
			"x-api-key": this.options.kilocodeToken ?? "",
			Authorization: `Bearer ${this.options.kilocodeToken}`,
			...this.customRequestOptions(taskId ? { taskId, mode: "code" } : undefined)?.headers,
		}

		// temperature: 0.2 is mentioned as a sane example in mistral's docs and is what continue uses.
		const temperature = 0.2
		const maxTokens = 256

		const response = await fetch(endpoint, {
			method: "POST",
			body: JSON.stringify({
				model: model.id,
				prompt: prefix,
				suffix,
				max_tokens: Math.min(maxTokens, model.maxTokens ?? maxTokens),
				temperature,
				top_p: model.topP,
				stream: true,
			}),
			headers,
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`FIM streaming failed: ${response.status} ${response.statusText} - ${errorText}`)
		}

		for await (const data of streamSse(response)) {
			const content = data.choices?.[0]?.delta?.content
			if (content) {
				yield content
			}

			// Call usage callback when available
			if (data.usage && onUsage) {
				onUsage(data.usage)
			}
		}
	}
}
