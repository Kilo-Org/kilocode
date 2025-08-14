import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, tarsDefaultModelId, tarsDefaultModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { RouterProvider } from "./router-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

// TARS usage includes an extra field for Anthropic use cases.
// Safely cast the prompt token details section to the appropriate structure.
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
			baseURL: "https://api.router.tetrate.ai/v1",
			apiKey: options.tarsApiKey,
			modelId: options.tarsModelId,
			defaultModelId: tarsDefaultModelId,
			defaultModelInfo: tarsDefaultModelInfo,
		})
	}

	protected processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
		const tarsUsage = usage as TarsUsage
		const inputTokens = tarsUsage?.prompt_tokens || 0
		const outputTokens = tarsUsage?.completion_tokens || 0
		const cacheWriteTokens = tarsUsage?.prompt_tokens_details?.caching_tokens || 0
		const cacheReadTokens = tarsUsage?.prompt_tokens_details?.cached_tokens || 0
		const totalCost = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: 0

		return {
			type: "usage",
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
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
			max_tokens,
			temperature,
			stream: true,
			stream_options: { include_usage: true },
		}

		const stream = await this.client.chat.completions.create(completionParams)
		let lastUsage: any = undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string | undefined) || "" }
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, info)
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

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: prompt }]

		const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
			model,
			max_tokens,
			messages: openAiMessages,
			temperature: temperature,
		}

		const response = await this.client.chat.completions.create(completionParams)
		return response.choices[0]?.message.content || ""
	}
}
