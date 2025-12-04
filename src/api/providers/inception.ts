// kilocode_change - file added

import { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from ".."
import { ApiHandlerOptions } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"
import { RouterProvider } from "./router-provider"

import { inceptionDefaultModelId, inceptionDefaultModelInfo } from "@roo-code/types"

import { getModels } from "./fetchers/modelCache"
import { getModelParams } from "../transform/model-params"
import Anthropic from "@anthropic-ai/sdk"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import OpenAI from "openai"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addNativeToolCallsToParams, ToolCallAccumulator } from "./kilocode/nativeToolCallHelpers"

export class InceptionLabsHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options: {
				...options,
				openAiHeaders: {
					"X-Inceptionlabs-Source": "kilocode",
					"X-Inceptionlabs-Version": `2025-10-31`,
				},
			},
			name: "inception",
			baseURL: `${options.inceptionLabsBaseUrl || "https://api.inceptionlabs.ai/v1/"}`,
			apiKey: options.inceptionLabsApiKey || "not-provided",
			modelId: options.inceptionLabsModelId,
			defaultModelId: inceptionDefaultModelId,
			defaultModelInfo: inceptionDefaultModelInfo,
		})
	}

	public override async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		return this.getModel()
	}

	override getModel() {
		const id = this.options.inceptionLabsModelId ?? inceptionDefaultModelId
		const info = this.models[id] ?? inceptionDefaultModelInfo

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
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.fetchModel()
		const { id: modelId, info, reasoningEffort: reasoning_effort } = await this.fetchModel()
		let prompt_cache_key = undefined

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			reasoning_effort,
			prompt_cache_key,
		} as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}
		if (this.options.includeMaxTokens == true && info.maxTokens) {
			;(requestOptions as any).max_completion_tokens = this.options.modelMaxTokens
		}
		;(requestOptions as any).stream_options = { include_usage: true }

		const { data: stream } = await this.client.chat.completions
			.create(addNativeToolCallsToParams(requestOptions, this.options, _metadata))
			.withResponse()

		let lastUsage: OpenAI.CompletionUsage | undefined
		const toolCallAccumulator = new ToolCallAccumulator()
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			yield* toolCallAccumulator.processChunk(chunk)

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
		await this.fetchModel()
		const { id: modelId, info } = this.getModel()

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		}
		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}
		if (this.options.includeMaxTokens === true && info.maxTokens) {
			;(requestOptions as any).max_completion_tokens = this.options.modelMaxTokens || info.maxTokens
		}

		const resp = await this.client.chat.completions.create(requestOptions)
		return resp.choices[0]?.message?.content || ""
	}

	protected processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		const totalCost = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: undefined

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost: totalCost?.totalCost || undefined,
		}
	}
}
