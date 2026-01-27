import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	NATIVE_TOOL_DEFAULTS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { XmlMatcher } from "../../utils/xml-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { handleOpenAIError } from "./utils/openai-error-handler"

// TODO: Rename this to OpenAICompatibleHandler. Also, I think the
// `OpenAINativeHandler` can subclass from this, since it's obviously
// compatible with the OpenAI API. We can also rename it to `OpenAIHandler`.
export class OpenAiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected client: OpenAI
	private readonly providerName = "OpenAI"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openAiBaseUrl ?? "https://api.openai.com/v1"
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
		const urlHost = this._getUrlHost(this.options.openAiBaseUrl)
		const isAzureOpenAi = urlHost === "azure.com" || urlHost.endsWith(".azure.com") || options.openAiUseAzure

		const headers = {
			...DEFAULT_HEADERS,
			...(this.options.openAiHeaders || {}),
		}

		const timeout = getApiRequestTimeout()

		if (isAzureAiInference) {
			// Azure AI Inference Service (e.g., for DeepSeek) uses a different path structure
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				defaultQuery: { "api-version": this.options.azureApiVersion || "2024-05-01-preview" },
				timeout,
			})
		} else if (isAzureOpenAi) {
			// Azure API shape slightly differs from the core API shape:
			// https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: headers,
				timeout,
			})
		} else {
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout,
			})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelUrl = this.options.openAiBaseUrl ?? ""
		const modelId = this.options.openAiModelId ?? ""
		const enabledR1Format = this.options.openAiR1FormatEnabled ?? false
		const isAzureAiInference = this._isAzureAiInference(modelUrl)
		const deepseekReasoner = modelId.includes("deepseek-reasoner") || enabledR1Format
		// kilocode_change removed const ark = modelUrl.includes(".volces.com")

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages, metadata)
			return
		}

		let systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		if (this.options.openAiStreamingEnabled ?? true) {
			let convertedMessages

			if (deepseekReasoner) {
				convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			} else {
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
			}

			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				temperature: this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
				messages: convertedMessages,
				stream: true as const,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				...(reasoning && reasoning),
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" &&
					metadata.parallelToolCalls === true && {
						parallel_tool_calls: true,
					}),
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
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
			const activeToolCallIds = new Set<string>()

			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta ?? {}
				const finishReason = chunk.choices?.[0]?.finish_reason

				if (delta.content) {
					for (const chunk of matcher.update(delta.content)) {
						yield chunk
					}
				}

				// kilocode_change start: reasoning
				const reasoningText =
					"reasoning_content" in delta && typeof delta.reasoning_content === "string"
						? delta.reasoning_content
						: "reasoning" in delta && typeof delta.reasoning === "string"
							? delta.reasoning
							: undefined
				if (reasoningText) {
					yield {
						type: "reasoning",
						text: reasoningText,
					}
				}
				// kilocode_change end

				yield* this.processToolCalls(delta, finishReason, activeToolCallIds)

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
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: deepseekReasoner
					? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
					: [systemMessage, ...convertToOpenAiMessages(messages)],
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" &&
					metadata.parallelToolCalls === true && {
						parallel_tool_calls: true,
					}),
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					this._isAzureAiInference(modelUrl) ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			// kilocode_change start: reasoning
			const message = response.choices[0]?.message
			if (message) {
				if ("reasoning" in message && typeof message.reasoning === "string") {
					yield {
						type: "reasoning",
						text: message.reasoning,
					}
				}
				if (message.content) {
					yield {
						type: "text",
						text: message.content || "",
					}
				}
			}
			// kilocode_change end

			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
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

	override getModel() {
		const id = this.options.openAiModelId ?? ""
		// Ensure OpenAI-compatible models default to supporting native tool calling.
		// This is required for [`Task.attemptApiRequest()`](src/core/task/Task.ts:3817) to
		// include tool definitions in the request.
		const info: ModelInfo = {
			...NATIVE_TOOL_DEFAULTS,
			...(this.options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
		}
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
			const model = this.getModel()
			const modelInfo = model.info

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			return response.choices?.[0]?.message.content || ""
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
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelInfo = this.getModel().info
		const methodIsAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)

		if (this.options.openAiStreamingEnabled ?? true) {
			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" &&
					metadata.parallelToolCalls === true && {
						parallel_tool_calls: true,
					}),
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield* this.handleStreamResponse(stream)
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
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
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" &&
					metadata.parallelToolCalls === true && {
						parallel_tool_calls: true,
					}),
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message
			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	private async *handleStreamResponse(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): ApiStream {
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta) {
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				yield* this.processToolCalls(delta, finishReason, activeToolCallIds)
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

	/**
	 * Helper generator to process tool calls from a stream chunk.
	 * Tracks active tool call IDs and yields tool_call_partial and tool_call_end events.
	 * @param delta - The delta object from the stream chunk
	 * @param finishReason - The finish_reason from the stream chunk
	 * @param activeToolCallIds - Set to track active tool call IDs (mutated in place)
	 */
	private *processToolCalls(
		delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
		finishReason: string | null | undefined,
		activeToolCallIds: Set<string>,
	): Generator<
		| { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
		| { type: "tool_call_end"; id: string }
	> {
		if (delta?.tool_calls) {
			for (const toolCall of delta.tool_calls) {
				if (toolCall.id) {
					activeToolCallIds.add(toolCall.id)
				}
				yield {
					type: "tool_call_partial",
					index: toolCall.index,
					id: toolCall.id,
					name: toolCall.function?.name,
					arguments: toolCall.function?.arguments,
				}
			}
		}

		// Emit tool_call_end events when finish_reason is "tool_calls"
		// This ensures tool calls are finalized even if the stream doesn't properly close
		if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
			for (const id of activeToolCallIds) {
				yield { type: "tool_call_end", id }
			}
			activeToolCallIds.clear()
		}
	}

	protected _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").host
		} catch (error) {
			return ""
		}
	}

	private _isGrokXAI(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.includes("x.ai")
	}

	protected _isAzureAiInference(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.endsWith(".services.ai.azure.com")
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
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
