// kilocode_change - provider added

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type SyntheticModelId, syntheticDefaultModelId, syntheticModels } from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { getModels } from "./fetchers/modelCache"
import { getModelParams } from "../transform/model-params"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { XmlMatcher } from "../../utils/xml-matcher"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"
import { ToolCallAccumulator } from "./kilocode/nativeToolCallHelpers"
import { calculateApiCostOpenAI } from "../../shared/cost"

// Default max output tokens for Synthetic provider
const SYNTHETIC_DEFAULT_MAX_TOKENS = 8192

// Default base URL for Synthetic provider
const SYNTHETIC_DEFAULT_BASE_URL = "https://api.synthetic.new/openai/v1"

export class SyntheticHandler extends BaseOpenAiCompatibleProvider<SyntheticModelId> {
	protected models: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Synthetic",
			baseURL: options.syntheticBaseUrl || SYNTHETIC_DEFAULT_BASE_URL,
			apiKey: options.syntheticApiKey,
			defaultProviderModelId: syntheticDefaultModelId,
			providerModels: syntheticModels,
			defaultTemperature: 0.5,
		})
	}

	public async fetchModel() {
		this.models = await getModels({
			provider: "synthetic",
			apiKey: this.options.apiKey,
			baseUrl: this.options.syntheticBaseUrl,
		})
		return this.getModel()
	}

	override getModel() {
		const id = (this.options.apiModelId as SyntheticModelId) ?? syntheticDefaultModelId
		const info = this.models[id] ?? syntheticModels[id] ?? syntheticModels[syntheticDefaultModelId]

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
		await this.fetchModel()
		const { id: modelId, info, maxTokens: defaultMaxTokens } = this.getModel()

		const temperature = this.options.modelTemperature ?? 0.5

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			...(metadata?.toolProtocol === "native" && {
				parallel_tool_calls: metadata.parallelToolCalls ?? false,
			}),
		}

		// Only include max_tokens if includeMaxTokens is enabled (defaults to true)
		if (this.options.includeMaxTokens !== false) {
			// Use user-configured modelMaxTokens if available, otherwise use default of 8192
			const maxTokens = this.options.modelMaxTokens || SYNTHETIC_DEFAULT_MAX_TOKENS
			params.max_tokens = maxTokens
		}

		// Add thinking parameter if reasoning is enabled and model supports it
		if (this.options.enableReasoningEffort && info.supportsReasoningBinary) {
			;(params as any).thinking = { type: "enabled" }
		}

		const stream = await this.client.chat.completions.create(params)

		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		const toolCallAccumulator = new ToolCallAccumulator()
		let lastUsage: OpenAI.CompletionUsage | undefined

		for await (const chunk of stream) {
			verifyFinishReason(chunk.choices?.[0])

			const delta = chunk.choices?.[0]?.delta

			yield* toolCallAccumulator.processChunk(chunk)

			if (delta?.content) {
				for (const processedChunk of matcher.update(delta.content)) {
					yield processedChunk
				}
			}

			if (delta) {
				for (const key of ["reasoning_content", "reasoning"] as const) {
					if (key in delta) {
						const reasoning_content = ((delta as any)[key] as string | undefined) || ""
						if (reasoning_content?.trim()) {
							yield { type: "reasoning", text: reasoning_content }
						}
						break
					}
				}
			}

			// Emit raw tool call chunks - NativeToolCallParser handles state management
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

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, info)
		}

		// Process any remaining content
		for (const processedChunk of matcher.final()) {
			yield processedChunk
		}
	}

	override async completePrompt(prompt: string): Promise<string> {
		await this.fetchModel()
		const { id: modelId, info, maxTokens: defaultMaxTokens } = this.getModel()

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		}

		// Only include max_tokens if includeMaxTokens is enabled (defaults to true)
		if (this.options.includeMaxTokens !== false) {
			// Use user-configured modelMaxTokens if available, otherwise use default of 8192
			const maxTokens = this.options.modelMaxTokens || SYNTHETIC_DEFAULT_MAX_TOKENS
			params.max_tokens = maxTokens
		}

		// Add thinking parameter if reasoning is enabled and model supports it
		if (this.options.enableReasoningEffort && info.supportsReasoningBinary) {
			;(params as any).thinking = { type: "enabled" }
		}

		const response = await this.client.chat.completions.create(params)
		return response.choices?.[0]?.message.content || ""
	}

	protected override processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		const { totalCost } = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: { totalCost: 0 }

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost,
		}
	}
}
