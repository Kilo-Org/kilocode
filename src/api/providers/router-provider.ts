import OpenAI from "openai"

import { type ModelInfo, type ModelRecord, NATIVE_TOOL_DEFAULTS } from "@roo-code/types"

import { ApiHandlerOptions, RouterName } from "../../shared/api"

import { BaseProvider } from "./base-provider"
import { getModels, getModelsFromCache } from "./fetchers/modelCache"

import { DEFAULT_HEADERS } from "./constants"

const TEMPERATURE_UNSUPPORTED_PREFIXES = ["openai/o3", "openai/gpt5", "gpt-5"] // kilocode_change

type RouterProviderOptions = {
	name: RouterName
	baseURL: string
	apiKey?: string
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	options: ApiHandlerOptions
}

export abstract class RouterProvider extends BaseProvider {
	protected readonly options: ApiHandlerOptions
	protected readonly name: RouterName
	protected models: ModelRecord = {}
	protected readonly modelId?: string
	protected readonly defaultModelId: string
	protected readonly defaultModelInfo: ModelInfo
	protected readonly client: OpenAI

	constructor({
		options,
		name,
		baseURL,
		apiKey = "not-provided",
		modelId,
		defaultModelId,
		defaultModelInfo,
	}: RouterProviderOptions) {
		super()

		this.options = options
		this.name = name
		this.modelId = modelId
		this.defaultModelId = defaultModelId
		this.defaultModelInfo = defaultModelInfo

		this.client = new OpenAI({
			baseURL,
			apiKey,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(options.openAiHeaders || {}),
			},
		})
	}

	public async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		return this.getModel()
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.modelId ?? this.defaultModelId

		// First check instance models (populated by fetchModel)
		// Merge native tool defaults for cached models that may lack these fields
		if (this.models[id]) {
			return { id, info: { ...NATIVE_TOOL_DEFAULTS, ...this.models[id] } }
		}

		// Fall back to global cache (synchronous disk/memory cache)
		// This ensures models are available before fetchModel() is called
		const cachedModels = getModelsFromCache(this.name)
		if (cachedModels?.[id]) {
			// Also populate instance models for future calls
			this.models = cachedModels
			return { id, info: { ...NATIVE_TOOL_DEFAULTS, ...cachedModels[id] } }
		}

		// Last resort: return default model
		return { id: this.defaultModelId, info: this.defaultModelInfo }
	}

	protected supportsTemperature(modelId: string): boolean {
		return !TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) => modelId.startsWith(prefix)) // kilocode_change
	}
}
