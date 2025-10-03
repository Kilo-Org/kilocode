import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, openAiModelInfoSaneDefaults } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { XmlMatcher } from "../../utils/xml-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

import { BaseProvider } from "./base-provider"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { fetchWithTimeout } from "./kilocode/fetchWithTimeout"
import { DEFAULT_HEADERS } from "./constants"
import { handleOpenAIError } from "./utils/openai-error-handler"
import {
	getProviderManifest,
	getProviderModels as fetchProviderModels,
	getProviderModelsFromCache,
	parseEmbeddedProviderData,
	type ProviderManifest,
} from "./fetchers/provider-defined"

const PROVIDER_DEFINED_TIMEOUT_MS = 3_600_000
const DEFAULT_PROVIDER_NAME = "Provider Defined"

export class ProviderDefinedHandler extends BaseProvider implements SingleCompletionHandler {
	protected readonly options: ApiHandlerOptions
	private client?: OpenAI
	private manifest?: ProviderManifest
	private modelCache?: Record<string, ModelInfo>
	private providerName = DEFAULT_PROVIDER_NAME
	private embeddedData?: {
		manifest: ProviderManifest
		models: Record<string, ModelInfo>
	}

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		if (!options.providerDefinedManifestUrl) {
			if (!options.providerDefinedEmbeddedJson) {
				throw new Error("Provider manifest URL or embedded JSON is required for provider-defined integrations")
			}
		}

		const embeddedJson = options.providerDefinedEmbeddedJson?.trim()
		if (embeddedJson) {
			try {
				this.embeddedData = parseEmbeddedProviderData(embeddedJson)
				this.providerName = this.embeddedData.manifest.name || DEFAULT_PROVIDER_NAME
			} catch (error) {
				throw new Error(`Invalid embedded provider data: ${(error as Error).message}`)
			}
		}
	}

	private get manifestUrl(): string {
		if (!this.options.providerDefinedManifestUrl) {
			throw new Error("Provider manifest URL is not configured")
		}
		return this.options.providerDefinedManifestUrl
	}

	private get userHeaders(): Record<string, string> | undefined {
		return this.options.providerDefinedHeaders
	}

	private get apiKey(): string | undefined {
		return this.options.providerDefinedApiKey || this.options.apiKey
	}

	private headersWithAuthorization(manifestHeaders?: Record<string, string>) {
		const headers: Record<string, string> = {}

		if (manifestHeaders) {
			for (const [key, value] of Object.entries(manifestHeaders)) {
				headers[key] = value
			}
		}

		if (this.userHeaders) {
			for (const [key, value] of Object.entries(this.userHeaders)) {
				headers[key] = value
			}
		}

		const hasAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === "authorization")

		if (this.apiKey && !hasAuthorization) {
			headers.Authorization = `Bearer ${this.apiKey}`
		}

		return headers
	}

	private async ensureManifest(): Promise<ProviderManifest> {
		if (this.embeddedData) {
			return this.embeddedData.manifest
		}

		if (this.manifest) {
			return this.manifest
		}

		const manifest = await getProviderManifest(this.manifestUrl, {
			headers: this.userHeaders,
		})

		this.manifest = manifest
		this.providerName = manifest.name || DEFAULT_PROVIDER_NAME

		return manifest
	}

	private async ensureClient(): Promise<OpenAI> {
		if (this.client) {
			return this.client
		}

		const manifest = await this.ensureManifest()

		const headers = this.headersWithAuthorization(manifest.headers)

		this.client = new OpenAI({
			baseURL: manifest.baseUrl,
			apiKey: this.apiKey || "noop",
			defaultHeaders: { ...DEFAULT_HEADERS, ...headers },
			timeout: PROVIDER_DEFINED_TIMEOUT_MS,
			fetch: fetchWithTimeout(PROVIDER_DEFINED_TIMEOUT_MS),
		})

		return this.client
	}

	private async ensureModels(forceRefresh = false): Promise<Record<string, ModelInfo>> {
		if (this.embeddedData) {
			this.modelCache = this.embeddedData.models
			return this.modelCache
		}

		if (!forceRefresh && this.modelCache) {
			return this.modelCache
		}

		const models = await fetchProviderModels({
			manifestUrl: this.manifestUrl,
			apiKey: this.apiKey,
			headers: this.userHeaders,
			forceRefresh,
		})

		this.modelCache = models
		return models
	}

	private async resolveModel(forceRefresh = false): Promise<{ id: string; info: ModelInfo }> {
		const models = await this.ensureModels(forceRefresh)
		const configuredId = this.options.providerDefinedModelId?.trim()

		if (configuredId && models[configuredId]) {
			return { id: configuredId, info: models[configuredId] }
		}

		const [firstModelId] = Object.keys(models)

		if (firstModelId) {
			return { id: firstModelId, info: models[firstModelId] }
		}

		return {
			id: configuredId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const toContentBlocks = (
			blocks: Anthropic.Messages.MessageParam[] | string,
		): Anthropic.Messages.ContentBlockParam[] => {
			if (typeof blocks === "string") {
				return [{ type: "text", text: blocks }]
			}

			const result: Anthropic.Messages.ContentBlockParam[] = []
			for (const msg of blocks) {
				if (typeof msg.content === "string") {
					result.push({ type: "text", text: msg.content })
				} else if (Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part.type === "text") {
							result.push({ type: "text", text: part.text })
						}
					}
				}
			}
			return result
		}

		let inputTokens = 0
		try {
			inputTokens = await this.countTokens([{ type: "text", text: systemPrompt }, ...toContentBlocks(messages)])
		} catch (error) {
			console.error("[ProviderDefined] Failed to count input tokens:", error)
		}

		const client = await this.ensureClient()
		const { id: modelId, info: modelInfo } = await this.resolveModel()

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
		}

		if (this.options.modelTemperature !== undefined) {
			params.temperature = this.options.modelTemperature
		}

		if (modelInfo.maxTokens && modelInfo.maxTokens > 0) {
			params.max_tokens = modelInfo.maxTokens
		}

		let assistantText = ""
		let outputTokens = 0
		let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined

		try {
			const response = await client.chat.completions.create(params)
			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			for await (const chunk of response) {
				const delta = chunk.choices[0]?.delta

				if (delta?.content) {
					assistantText += delta.content
					for (const processedChunk of matcher.update(delta.content)) {
						yield processedChunk
					}
				}

				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}

			for (const processedChunk of matcher.final()) {
				yield processedChunk
			}

			if (assistantText) {
				try {
					outputTokens = await this.countTokens([{ type: "text", text: assistantText }])
				} catch (error) {
					console.error("[ProviderDefined] Failed to count output tokens:", error)
				}
			}

			const promptTokens = lastUsage?.prompt_tokens ?? inputTokens
			const completionTokens = lastUsage?.completion_tokens ?? outputTokens

			yield {
				type: "usage",
				inputTokens: promptTokens,
				outputTokens: completionTokens,
			}
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const client = await this.ensureClient()
		const { id: modelId, info: modelInfo } = await this.resolveModel()

		try {
			const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.options.modelTemperature !== undefined) {
				params.temperature = this.options.modelTemperature
			}

			if (modelInfo.maxTokens && modelInfo.maxTokens > 0) {
				params.max_tokens = modelInfo.maxTokens
			}

			const response = await client.chat.completions.create(params)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	override getModel(): { id: string; info: ModelInfo } {
		const configuredId = this.options.providerDefinedModelId?.trim()
		const cachedModels = this.embeddedData
			? this.embeddedData.models
			: this.modelCache ||
				(this.options.providerDefinedManifestUrl
					? getProviderModelsFromCache(this.options.providerDefinedManifestUrl)
					: undefined) ||
				{}

		if (configuredId && cachedModels[configuredId]) {
			return { id: configuredId, info: cachedModels[configuredId] }
		}

		const [firstModelId] = Object.keys(cachedModels)

		if (firstModelId) {
			return { id: firstModelId, info: cachedModels[firstModelId] }
		}

		return {
			id: configuredId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}

export const getProviderModels = fetchProviderModels
