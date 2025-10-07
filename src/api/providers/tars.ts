import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { tarsDefaultModelId, tarsDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { RouterProvider } from "./router-provider"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"

// TARS usage includes an extra field for Anthropic-style caching.
interface TarsUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
	total_cost?: number
}

export class TarsHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "tars",
			baseURL: options.tarsBaseUrl || "https://api.router.tetrate.ai/v1",
			apiKey: options.tarsApiKey,
			modelId: options.tarsModelId,
			defaultModelId: tarsDefaultModelId,
			defaultModelInfo: tarsDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const { id: model, info } = await this.fetchModel()

		const params = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
		})

		const { maxTokens: max_tokens, temperature } = params

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
			messages: openAiMessages,
			model,
			...(max_tokens && max_tokens > 0 && { max_tokens }),
			...(temperature !== undefined && this.supportsTemperature(model) && { temperature }),
			stream: true,
			stream_options: { include_usage: true },
		}

		const stream = await this.client.chat.completions.create(completionParams)
		let lastUsage: TarsUsage | undefined = undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string | undefined) || "" }
			}

			if (chunk.usage) {
				lastUsage = chunk.usage as TarsUsage
			}
		}

		if (lastUsage) {
			const inputTokens = lastUsage.prompt_tokens || 0
			const outputTokens = lastUsage.completion_tokens || 0
			const cacheWriteTokens = lastUsage.prompt_tokens_details?.caching_tokens || 0
			const cacheReadTokens = lastUsage.prompt_tokens_details?.cached_tokens || 0
			const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
				totalCost,
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: model, info } = await this.fetchModel()
		const params = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
		})
		const { maxTokens: max_tokens, temperature } = params

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: prompt }]

		const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
			model,
			...(max_tokens && max_tokens > 0 && { max_tokens }),
			messages: openAiMessages,
			...(temperature !== undefined && this.supportsTemperature(model) && { temperature }),
		}

		const response = await this.client.chat.completions.create(completionParams)
		return response.choices[0]?.message.content || ""
	}
}
