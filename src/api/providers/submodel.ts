import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { convertToOpenAiMessages } from "../transform/openai-format"

import { DEEP_SEEK_DEFAULT_TEMPERATURE, submodelDefaultModelId, submodelDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"

export class SubmodelHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "submodel",
			baseURL: "https://llm.submodel.ai/v1",
			apiKey: options.submodelApiKey,
			modelId: options.submodelModelId,
			defaultModelId: submodelDefaultModelId,
			defaultModelInfo: submodelDefaultModelInfo,
		})
	}

	async createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	) {
		//const {
		//	id: model,
		//	info: { maxTokens: max_tokens },
		//} = this.getModel()

		const {
			id: model,
			info: { maxTokens: max_tokens },
		} = await this.fetchModel()

		const temperature = this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		}

		return this.client.chat.completions.create(params)
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(systemPrompt, messages, metadata)

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

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId } = await this.fetchModel()

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			})

			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Submodel completion error: ${error.message}`)
			}

			throw error
		}
	}
}
