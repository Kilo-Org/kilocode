import { Anthropic } from "@anthropic-ai/sdk"
import { createGroq } from "@ai-sdk/groq"
import { streamText, generateText, ToolSet } from "ai"

import { groqModels, groqDefaultModelId, type ModelInfo } from "@roo-code/types"

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

const GROQ_DEFAULT_TEMPERATURE = 0.5

/**
 * Groq provider using the dedicated @ai-sdk/groq package.
 * Provides native support for reasoning models and prompt caching.
 */
export class GroqHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createGroq>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Create the Groq provider using AI SDK
		this.provider = createGroq({
			baseURL: "https://api.groq.com/openai/v1",
			apiKey: options.groqApiKey ?? "not-provided",
			headers: DEFAULT_HEADERS,
		})
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = this.options.apiModelId ?? groqDefaultModelId
		const info = groqModels[id as keyof typeof groqModels] || groqModels[groqDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: GROQ_DEFAULT_TEMPERATURE,
		})
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
	 * Process usage metrics from the AI SDK response, including Groq's cache metrics.
	 * Groq provides cache hit/miss info via providerMetadata for supported models.
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
			groq?: {
				promptCacheHitTokens?: number
				promptCacheMissTokens?: number
			}
		},
	): ApiStreamUsageChunk {
		// Extract cache metrics from Groq's providerMetadata
		const cacheReadTokens = providerMetadata?.groq?.promptCacheHitTokens ?? usage.details?.cachedInputTokens
		const cacheWriteTokens = providerMetadata?.groq?.promptCacheMissTokens

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
	 * Groq supports reasoning for models like qwen/qwen3-32b via reasoningFormat: 'parsed'.
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
			temperature: this.options.modelTemperature ?? temperature ?? GROQ_DEFAULT_TEMPERATURE,
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
			throw handleAiSdkError(error, "Groq")
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
			temperature: this.options.modelTemperature ?? temperature ?? GROQ_DEFAULT_TEMPERATURE,
		})

		return text
	}
}
