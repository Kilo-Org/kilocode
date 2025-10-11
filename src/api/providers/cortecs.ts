import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import axios from "axios"

import { type ModelInfo, openAiModelInfoSaneDefaults } from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { XmlMatcher } from "../../utils/xml-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

import { handleOpenAIError } from "./utils/openai-error-handler"
import { getModels } from "./fetchers/modelCache"

type CortecsChatCompletionCreateParams = OpenAI.Chat.ChatCompletionCreateParams & {
	preference?: string | null
}

export class CortecsHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected models: ModelRecord = {}
	private client: OpenAI
	private baseURL: string
	private readonly providerName = "cortecs"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		this.baseURL = this.options.cortecsBaseUrl ?? "https://api.cortecs.ai/v1"
		const apiKey = this.options.cortecsApiKey ?? "not-provided"

		this.client = new OpenAI({
			baseURL: this.baseURL,
			apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelId = this.options.cortecsModelId ?? ""

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages)
			return
		}

		if (this.options.openAiStreamingEnabled ?? true) {
			let systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
				role: "system",
				content: systemPrompt,
			}

			let convertedMessages

			if (modelInfo.supportsPromptCache) {
				systemMessage = {
					role: "system",
					content: [
						{
							type: "text",
							text: systemPrompt,
							// @ts-ignore-next-line
							cache_control: { type: "ephemeral" },
						},
					],
				}
			}

			convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

			if (modelInfo.supportsPromptCache) {
				// Note: the following logic is copied from openrouter:
				// Add cache_control to the last two user messages
				// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
				const lastTwoUserMessages = convertedMessages.filter((msg) => msg.role === "user").slice(-2)

				lastTwoUserMessages.forEach((msg) => {
					if (typeof msg.content === "string") {
						msg.content = [{ type: "text", text: msg.content }]
					}

					if (Array.isArray(msg.content)) {
						// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
						let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

						if (!lastTextPart) {
							lastTextPart = { type: "text", text: "..." }
							msg.content.push(lastTextPart)
						}

						// @ts-ignore-next-line
						lastTextPart["cache_control"] = { type: "ephemeral" }
					}
				})
			}

			const requestOptions: CortecsChatCompletionCreateParams = {
				model: modelId,
				messages: convertedMessages,
				stream: true as const,
				stream_options: { include_usage: true },
				...(reasoning && reasoning),
			}

			// Only include temperature if explicitly set
			if (
				this.options.modelTemperature !== undefined &&
				this.options.modelTemperature !== null // kilocode_change: some providers like Chutes don't like this
			) {
				requestOptions.temperature = this.options.modelTemperature
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)
			// Add routing preference if needed
			this.addRoutingPreferenceIfNeeded(requestOptions)

			let stream
			try {
				stream = await this.client.chat.completions.create(requestOptions)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			let lastUsage

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta ?? {}

				if (delta.content) {
					for (const chunk of matcher.update(delta.content)) {
						yield chunk
					}
				}

				if ("reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						text: (delta.reasoning_content as string | undefined) || "",
					}
				}
				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}

			for (const chunk of matcher.final()) {
				yield chunk
			}

			if (lastUsage) {
				yield this.processUsageMetrics(lastUsage, modelInfo)
			}
		} else {
			// o1 for instance doesnt support streaming, non-1 temp, or system prompt
			const systemMessage: OpenAI.Chat.ChatCompletionUserMessageParam = {
				role: "user",
				content: systemPrompt,
			}

			const requestOptions: CortecsChatCompletionCreateParams = {
				model: modelId,
				messages: [systemMessage, ...convertToOpenAiMessages(messages)],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)
			// Add routing preference if needed
			this.addRoutingPreferenceIfNeeded(requestOptions)

			let response
			try {
				response = await this.client.chat.completions.create(requestOptions)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield {
				type: "text",
				text: response.choices[0]?.message.content || "",
			}

			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	protected processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.cache_creation_input_tokens || undefined,
			cacheReadTokens: usage?.cache_read_input_tokens || undefined,
		}
	}

	public async fetchModel() {
		this.models = await getModels({ provider: "cortecs", baseUrl: this.baseURL })
		return this.getModel()
	}

	override getModel() {
		const id = this.options.cortecsModelId ?? ""
		const info = this.models[id] ?? openAiModelInfoSaneDefaults
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const model = this.getModel()
			const modelInfo = model.info

			const requestOptions: CortecsChatCompletionCreateParams = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)
			// Add routing preference if needed
			this.addRoutingPreferenceIfNeeded(requestOptions)

			let response
			try {
				response = await this.client.chat.completions.create(requestOptions)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} completion error: ${error.message}`)
			}

			throw error
		}
	}

	private async *handleO3FamilyMessage(
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		const modelInfo = this.getModel().info

		if (this.options.openAiStreamingEnabled ?? true) {
			const requestOptions: CortecsChatCompletionCreateParams = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)
			// Add routing preference if needed
			this.addRoutingPreferenceIfNeeded(requestOptions)

			let stream
			try {
				stream = await this.client.chat.completions.create(requestOptions)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield* this.handleStreamResponse(stream)
		} else {
			const requestOptions: CortecsChatCompletionCreateParams = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)
			// Add routing preference if needed
			this.addRoutingPreferenceIfNeeded(requestOptions)

			let response
			try {
				response = await this.client.chat.completions.create(requestOptions)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield {
				type: "text",
				text: response.choices[0]?.message.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	private async *handleStreamResponse(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): ApiStream {
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	private _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").host
		} catch (error) {
			return ""
		}
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(requestOptions: CortecsChatCompletionCreateParams, modelInfo: ModelInfo): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}

	protected addRoutingPreferenceIfNeeded(requestOptions: CortecsChatCompletionCreateParams): void {
		if (
			this.options.cortecsRoutingPreference !== undefined &&
			this.options.cortecsRoutingPreference !== null &&
			this.options.cortecsRoutingPreference !== "default"
		) {
			requestOptions.preference = this.options.cortecsRoutingPreference
		}
	}
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	try {
		if (!baseUrl) {
			return []
		}

		// Trim whitespace from baseUrl to handle cases where users accidentally include spaces
		const trimmedBaseUrl = baseUrl.trim()

		if (!URL.canParse(trimmedBaseUrl)) {
			return []
		}

		const config: Record<string, any> = {}
		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			...(openAiHeaders || {}),
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		if (Object.keys(headers).length > 0) {
			config["headers"] = headers
		}

		const response = await axios.get(`${trimmedBaseUrl}/models`, config)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}
