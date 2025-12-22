import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type XAIModelId, xaiDefaultModelId, xaiModels } from "@roo-code/types"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"
import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { verifyFinishReason } from "./kilocode/verifyFinishReason" // kilocode_change
import { handleOpenAIError } from "./utils/openai-error-handler"

const XAI_DEFAULT_TEMPERATURE = 0

export class XAIHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "xAI"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const apiKey = this.options.xaiApiKey ?? "not-provided"

		this.client = new OpenAI({
			baseURL: "https://api.x.ai/v1",
			apiKey: apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	override getModel() {
		const id =
			this.options.apiModelId && this.options.apiModelId in xaiModels
				? (this.options.apiModelId as XAIModelId)
				: xaiDefaultModelId

		const info = xaiModels[id]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info: modelInfo, reasoning } = this.getModel()

		// Check if model supports native tools and tools are provided with native protocol
		const supportsNativeTools = modelInfo.supportsNativeTools ?? false
		const useNativeTools =
			supportsNativeTools && metadata?.tools && metadata.tools.length > 0 && metadata?.toolProtocol !== "xml"

		// Use the OpenAI-compatible API.
		const requestOptions = {
			model: modelId,
			max_tokens: modelInfo.maxTokens,
			temperature: this.options.modelTemperature ?? XAI_DEFAULT_TEMPERATURE,
			messages: [
				{ role: "system", content: systemPrompt },
				...convertToOpenAiMessages(messages),
			] as OpenAI.Chat.ChatCompletionMessageParam[],
			stream: true as const,
			stream_options: { include_usage: true },
			...(reasoning && reasoning),
			...(useNativeTools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(useNativeTools && metadata.tool_choice && { tool_choice: metadata.tool_choice }),
			...(useNativeTools && { parallel_tool_calls: metadata?.parallelToolCalls ?? false }),
		}

		let stream
		try {
			stream = await this.client.chat.completions.create(requestOptions)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		for await (const chunk of stream) {
			verifyFinishReason(chunk.choices[0]) // kilocode_change
			const delta = chunk.choices[0]?.delta
			const finishReason = chunk.choices[0]?.finish_reason

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: delta.reasoning_content as string,
				}
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

			// Process finish_reason to emit tool_call_end events
			// This ensures tool calls are finalized even if the stream doesn't properly close
			if (finishReason) {
				const endEvents = NativeToolCallParser.processFinishReason(finishReason)
				for (const event of endEvents) {
					yield event
				}
			}

			if (chunk.usage) {
				// Extract detailed token information if available
				// First check for prompt_tokens_details structure (real API response)
				const promptDetails = "prompt_tokens_details" in chunk.usage ? chunk.usage.prompt_tokens_details : null
				const cachedTokens = promptDetails && "cached_tokens" in promptDetails ? promptDetails.cached_tokens : 0

				// Fall back to direct fields in usage (used in test mocks)
				const readTokens =
					cachedTokens ||
					("cache_read_input_tokens" in chunk.usage ? (chunk.usage as any).cache_read_input_tokens : 0)
				const writeTokens =
					"cache_creation_input_tokens" in chunk.usage ? (chunk.usage as any).cache_creation_input_tokens : 0

				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: readTokens,
					cacheWriteTokens: writeTokens,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, reasoning } = this.getModel()

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				...(reasoning && reasoning),
			})

			return response.choices[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}
}
