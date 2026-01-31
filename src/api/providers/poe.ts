// kilocode_change - provider added
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	type ReasoningEffortExtended,
	poeDefaultModelId,
	poeDefaultModelInfo,
	POE_BASE_URL,
	NATIVE_TOOL_DEFAULTS,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"
import { getModels } from "./fetchers/modelCache"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"
import { handleOpenAIError } from "./utils/openai-error-handler"

// Extended params type for Poe-specific fields
type PoeExtensions = {
	thinking_budget?: number
}

type PoeChatCompletionParamsStreaming = OpenAI.Chat.ChatCompletionCreateParamsStreaming & PoeExtensions
type PoeChatCompletionParamsNonStreaming = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & PoeExtensions

export class PoeHandler extends RouterProvider implements SingleCompletionHandler {
	private readonly providerName = "Poe"

	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "poe",
			baseURL: POE_BASE_URL,
			apiKey: options.poeApiKey || "not-provided",
			modelId: options.poeModelId,
			defaultModelId: poeDefaultModelId,
			defaultModelInfo: poeDefaultModelInfo,
		})
	}

	public override async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey })
		return this.getModel()
	}

	override getModel() {
		const id = this.options.poeModelId ?? poeDefaultModelId
		const cachedInfo = this.models[id] ?? poeDefaultModelInfo

		// Merge native tool defaults for cached models that may lack these fields
		const info: ModelInfo = { ...NATIVE_TOOL_DEFAULTS, ...cachedInfo }

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return { id, info, ...params }
	}

	/**
	 * Determines reasoning parameters based on model origin.
	 * Anthropic models use thinking_budget, OpenAI models use reasoning_effort.
	 * Other providers (Gemini, etc.) may have different requirements in the future.
	 */
	private getReasoningParams(
		modelId: string,
		reasoningBudget: number | undefined,
		reasoningEffort: ReasoningEffortExtended | undefined,
	): { thinking_budget?: number; reasoning_effort?: OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"] } {
		const isAnthropicModel = modelId.startsWith("claude-")
		const isOpenAiModel = modelId.startsWith("gpt-")

		if (isAnthropicModel && reasoningBudget) {
			return { thinking_budget: reasoningBudget }
		}

		// OpenAI only supports "low" | "medium" | "high" - filter out unsupported values
		if (isOpenAiModel && reasoningEffort) {
			if (["low", "medium", "high"].includes(reasoningEffort)) {
				return {
					reasoning_effort: reasoningEffort as OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"],
				}
			}
		}

		// Other providers (Gemini, etc.) - no reasoning params for now
		return {}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const {
			id: modelId,
			info,
			maxTokens: max_tokens,
			temperature,
			reasoningBudget,
			reasoningEffort,
		} = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const reasoningParams = this.getReasoningParams(modelId, reasoningBudget, reasoningEffort)

		const completionParams: PoeChatCompletionParamsStreaming = {
			model: modelId,
			messages: openAiMessages,
			max_tokens,
			temperature,
			...reasoningParams,
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
		}

		let stream: Awaited<ReturnType<typeof this.client.chat.completions.create>> &
			AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
		try {
			stream = await this.client.chat.completions.create(completionParams)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		let lastUsage: any = undefined
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			verifyFinishReason(chunk.choices[0])
			const delta = chunk.choices[0]?.delta
			const finishReason = chunk.choices[0]?.finish_reason

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string | undefined) || "" }
			}

			// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
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
			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
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
		const {
			id: modelId,
			maxTokens: max_tokens,
			temperature,
			reasoningBudget,
			reasoningEffort,
		} = await this.fetchModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: prompt }]

		const reasoningParams = this.getReasoningParams(modelId, reasoningBudget, reasoningEffort)

		const completionParams: PoeChatCompletionParamsNonStreaming = {
			model: modelId,
			messages: openAiMessages,
			max_tokens,
			temperature,
			...reasoningParams,
		}

		let response: OpenAI.Chat.ChatCompletion
		try {
			response = await this.client.chat.completions.create(completionParams)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		return response.choices[0]?.message.content || ""
	}

	protected processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheWriteTokens = usage?.prompt_tokens_details?.caching_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		const costResult = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: { totalCost: 0 }

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost: costResult.totalCost,
		}
	}
}
