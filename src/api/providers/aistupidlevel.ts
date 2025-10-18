import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { aiStupidLevelDefaultModelId, aiStupidLevelDefaultModelInfo } from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"

const AISTUPIDLEVEL_DEFAULT_TEMPERATURE = 0.7

export class AIStupidLevelHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "aistupidlevel",
			baseURL: "https://api.aistupidlevel.info/v1",
			apiKey: options.aiStupidLevelApiKey,
			modelId: options.aiStupidLevelModelId,
			defaultModelId: aiStupidLevelDefaultModelId,
			defaultModelInfo: aiStupidLevelDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info } = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const body: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			messages: openAiMessages,
			temperature: this.supportsTemperature(modelId)
				? (this.options.modelTemperature ?? AISTUPIDLEVEL_DEFAULT_TEMPERATURE)
				: undefined,
			max_completion_tokens: info.maxTokens,
			stream: true,
		}

		const completion = await this.client.chat.completions.create(body)

		for await (const chunk of completion) {
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
					totalCost: 0, // AIStupidLevel handles cost tracking in their dashboard
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		try {
			const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				stream: false,
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? AISTUPIDLEVEL_DEFAULT_TEMPERATURE
			}

			requestOptions.max_completion_tokens = info.maxTokens

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`AIStupidLevel completion error: ${error.message}`)
			}
			throw error
		}
	}
}
