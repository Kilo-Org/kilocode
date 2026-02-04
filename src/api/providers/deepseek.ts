import { Anthropic } from "@anthropic-ai/sdk"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { streamText, generateText, ToolSet } from "ai"

import { deepSeekModels, deepSeekDefaultModelId, DEEP_SEEK_DEFAULT_TEMPERATURE, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import {
	convertToAiSdkMessages,
	convertToolsForAiSdk,
	processAiSdkStreamPart,
	mapToolChoice,
	handleAiSdkError,
} from "../transform/ai-sdk"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

/**
 * DeepSeek provider using the dedicated @ai-sdk/deepseek package.
 * Provides native support for reasoning (deepseek-reasoner) and prompt caching.
 */
export class DeepSeekHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createDeepSeek>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Create the DeepSeek provider using AI SDK
		this.provider = createDeepSeek({
			baseURL: options.deepSeekBaseUrl ?? "https://api.deepseek.com/v1",
			apiKey: options.deepSeekApiKey ?? "not-provided",
			headers: DEFAULT_HEADERS,
		})
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = this.options.apiModelId ?? deepSeekDefaultModelId
		const info = deepSeekModels[id as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	/**
	 * Get the language model for the configured model ID.
	 */
	protected getLanguageModel() {
		const { id } = this.getModel()
		return this.provider(id)
	}

	/**
	 * Process usage metrics from the AI SDK response, including DeepSeek's cache metrics.
	 * DeepSeek provides cache hit/miss info via providerMetadata.
	 */
	protected processUsageMetrics(
		usage: {
			inputTokens?: number
			outputTokens?: number
			details?: {
				cachedInputTokens?: number
				reasoningTokens?: number
			}
		},
		providerMetadata?: {
			deepseek?: {
				promptCacheHitTokens?: number
				promptCacheMissTokens?: number
			}
		},
	): ApiStreamUsageChunk {
		// Extract cache metrics from DeepSeek's providerMetadata
		const cacheReadTokens = providerMetadata?.deepseek?.promptCacheHitTokens ?? usage.details?.cachedInputTokens
		const cacheWriteTokens = providerMetadata?.deepseek?.promptCacheMissTokens

		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheReadTokens,
			cacheWriteTokens,
			reasoningTokens: usage.details?.reasoningTokens,
		}
	}

	/**
	 * Get the max tokens parameter to include in the request.
	 */
	protected getMaxOutputTokens(): number | undefined {
		const { info } = this.getModel()
		return this.options.modelMaxTokens || info.maxTokens || undefined
	}

	/**
	 * Create a message stream using the AI SDK.
	 * The AI SDK automatically handles reasoning for deepseek-reasoner model.
	 */
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { temperature } = this.getModel()
		const languageModel = this.getLanguageModel()

		// Convert messages to AI SDK format
		const aiSdkMessages = convertToAiSdkMessages(messages)

		// Convert tools to OpenAI format first, then to AI SDK format
		const openAiTools = this.convertToolsForOpenAI(metadata?.tools)
		const aiSdkTools = convertToolsForAiSdk(openAiTools) as ToolSet | undefined

		// Build the request options
		const requestOptions: Parameters<typeof streamText>[0] = {
			model: languageModel,
			system: systemPrompt,
			messages: aiSdkMessages,
			temperature: this.options.modelTemperature ?? temperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
			maxOutputTokens: this.getMaxOutputTokens(),
			tools: aiSdkTools,
			toolChoice: mapToolChoice(metadata?.tool_choice),
		}

		// Use streamText for streaming responses
		const result = streamText(requestOptions)

		try {
			// Process the full stream to get all events including reasoning
			for await (const part of result.fullStream) {
				for (const chunk of processAiSdkStreamPart(part)) {
					yield chunk
				}
			}

			// Yield usage metrics at the end, including cache metrics from providerMetadata
			const usage = await result.usage
			const providerMetadata = await result.providerMetadata
			if (usage) {
				yield this.processUsageMetrics(usage, providerMetadata as any)
			}
		} catch (error) {
			// Handle AI SDK errors (AI_RetryError, AI_APICallError, etc.)
			throw handleAiSdkError(error, "DeepSeek")
		}
	}

	/**
	 * Complete a prompt using the AI SDK generateText.
	 */
	async completePrompt(prompt: string): Promise<string> {
		const { temperature } = this.getModel()
		const languageModel = this.getLanguageModel()

		const { text } = await generateText({
			model: languageModel,
			prompt,
			maxOutputTokens: this.getMaxOutputTokens(),
			temperature: this.options.modelTemperature ?? temperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
		})

		return text
	}
}
