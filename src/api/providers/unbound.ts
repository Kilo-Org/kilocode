import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { unboundDefaultModelId, unboundDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import { addCacheBreakpoints as addVertexCacheBreakpoints } from "../transform/caching/vertex"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"
import { getModelParams } from "../transform/model-params"
import { getModels } from "./fetchers/modelCache"

const ORIGIN_APP = "kilo-code"

const DEFAULT_HEADERS = {
	"X-Unbound-Metadata": JSON.stringify({ labels: [{ key: "app", value: "kilo-code" }] }),
}

interface UnboundUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
}

type UnboundChatCompletionCreateParamsStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
	unbound_metadata: {
		originApp: string
		taskId?: string
		mode?: string
	}
}

type UnboundChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
	unbound_metadata: {
		originApp: string
	}
}

export class UnboundHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "unbound",
			baseURL: "https://api.getunbound.ai/v1",
			apiKey: options.unboundApiKey,
			modelId: options.unboundModelId,
			defaultModelId: unboundDefaultModelId,
			defaultModelInfo: unboundDefaultModelInfo,
		})
	}

	public override async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		return this.getModel()
	}

	override getModel() {
		const requestedId = this.options.unboundModelId ?? unboundDefaultModelId
		const modelExists = this.models[requestedId]
		const id = modelExists ? requestedId : unboundDefaultModelId
		const info = modelExists ? this.models[requestedId] : unboundDefaultModelInfo

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Ensure we have up-to-date model metadata
		await this.fetchModel()
		const { id: modelId, info } = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (info.supportsPromptCache) {
			if (modelId.startsWith("google/")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else if (modelId.startsWith("anthropic/")) {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}
		// Custom models from Vertex AI (no configuration) need to be handled differently.
		if (modelId.startsWith("vertex-ai/google.") || modelId.startsWith("vertex-ai/anthropic.")) {
			addVertexCacheBreakpoints(messages)
		}

		// Required by Anthropic; other providers default to max tokens allowed.
		let maxTokens: number | undefined

		if (modelId.startsWith("anthropic/")) {
			maxTokens = info.maxTokens ?? undefined
		}

		// Check if model supports native tools and tools are provided with native protocol
		const supportsNativeTools = info.supportsNativeTools ?? false
		const useNativeTools =
			supportsNativeTools && metadata?.tools && metadata.tools.length > 0 && metadata?.toolProtocol !== "xml"

		const requestOptions: UnboundChatCompletionCreateParamsStreaming = {
			model: modelId.split("/")[1],
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			unbound_metadata: {
				originApp: ORIGIN_APP,
				taskId: metadata?.taskId,
				mode: metadata?.mode,
			},
			...(useNativeTools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(useNativeTools && metadata.tool_choice && { tool_choice: metadata.tool_choice }),
			...(useNativeTools && { parallel_tool_calls: metadata?.parallelToolCalls ?? false }),
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		const { data: completion } = await this.client.chat.completions
			.create(requestOptions, { headers: DEFAULT_HEADERS })
			.withResponse()

		for await (const chunk of completion) {
			const delta = chunk.choices[0]?.delta
			const usage = chunk.usage as UnboundUsage

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (usage) {
				const usageData: ApiStreamUsageChunk = {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
				}

				// Only add cache tokens if they exist.
				if (usage.cache_creation_input_tokens) {
					usageData.cacheWriteTokens = usage.cache_creation_input_tokens
				}

				if (usage.cache_read_input_tokens) {
					usageData.cacheReadTokens = usage.cache_read_input_tokens
				}

				yield usageData
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		try {
			const requestOptions: UnboundChatCompletionCreateParamsNonStreaming = {
				model: modelId.split("/")[1],
				messages: [{ role: "user", content: prompt }],
				unbound_metadata: {
					originApp: ORIGIN_APP,
				},
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? 0
			}

			if (modelId.startsWith("anthropic/")) {
				requestOptions.max_tokens = info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions, { headers: DEFAULT_HEADERS })
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Unbound completion error: ${error.message}`)
			}

			throw error
		}
	}
}
