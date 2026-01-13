import { DEEP_SEEK_DEFAULT_TEMPERATURE, chutesDefaultModelId, chutesDefaultModelInfo } from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../shared/api"
import { getModelMaxOutputTokens } from "../../shared/api"
import { XmlMatcher } from "../../utils/xml-matcher"
import { convertToR1Format } from "../transform/r1-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

import { RouterProvider } from "./router-provider"

export class ChutesHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "chutes",
			baseURL: "https://llm.chutes.ai/v1",
			apiKey: options.chutesApiKey,
			modelId: options.apiModelId,
			defaultModelId: chutesDefaultModelId,
			defaultModelInfo: chutesDefaultModelInfo,
		})
	}

	private getCompletionParams(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
		const { id: model, info } = this.getModel()

		// Centralized cap: clamp to 20% of the context window (unless provider-specific exceptions apply)
		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: metadata.tools }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
		}

		// Only add temperature if model supports it
		if (this.supportsTemperature(model)) {
			params.temperature = this.options.modelTemperature ?? info.temperature
		}

		return params
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = await this.fetchModel()

		if (model.id.includes("DeepSeek-R1")) {
			const stream = await this.client.chat.completions.create({
				...this.getCompletionParams(systemPrompt, messages, metadata),
				messages: convertToR1Format([{ role: "user", content: systemPrompt }, ...messages]),
			})

			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta

				if (delta?.content) {
					for (const processedChunk of matcher.update(delta.content)) {
						yield processedChunk
					}
				}

				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
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

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}

			// Process any remaining content
			for (const processedChunk of matcher.final()) {
				yield processedChunk
			}
		} else {
			// For non-DeepSeek-R1 models, use standard OpenAI streaming
			const stream = await this.client.chat.completions.create(
				this.getCompletionParams(systemPrompt, messages, metadata),
			)

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta

				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				if (delta && "reasoning_content" in delta && delta.reasoning_content) {
					yield { type: "reasoning", text: (delta.reasoning_content as string | undefined) || "" }
				}

				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
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

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const model = await this.fetchModel()
		const { id: modelId, info } = model

		try {
			// Centralized cap: clamp to 20% of the context window (unless provider-specific exceptions apply)
			const max_tokens =
				getModelMaxOutputTokens({
					modelId,
					model: info,
					settings: this.options,
					format: "openai",
				}) ?? undefined

			const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				max_tokens,
			}

			// Only add temperature if model supports it
			if (this.supportsTemperature(modelId)) {
				const isDeepSeekR1 = modelId.includes("DeepSeek-R1")
				const defaultTemperature = isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0.5
				requestParams.temperature = this.options.modelTemperature ?? defaultTemperature
			}

			const response = await this.client.chat.completions.create(requestParams)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Chutes completion error: ${error.message}`)
			}
			throw error
		}
	}

	override getModel() {
		const model = super.getModel()
		const isDeepSeekR1 = model.id.includes("DeepSeek-R1")

		return {
			...model,
			info: {
				...model.info,
				temperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0.5,
			},
		}
	}
}
