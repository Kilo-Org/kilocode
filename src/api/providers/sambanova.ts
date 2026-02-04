import { Anthropic } from "@anthropic-ai/sdk"
import { createSambaNova } from "sambanova-ai-provider"
import { streamText, generateText, ToolSet } from "ai"

import { sambaNovaModels, sambaNovaDefaultModelId, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import {
	convertToAiSdkMessages,
	convertToolsForAiSdk,
	processAiSdkStreamPart,
	mapToolChoice,
	handleAiSdkError,
	flattenAiSdkMessagesToStringContent,
} from "../transform/ai-sdk"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

const SAMBANOVA_DEFAULT_TEMPERATURE = 0.7

/**
 * SambaNova provider using the dedicated sambanova-ai-provider package.
 * Provides native support for various models including Llama models.
 */
export class SambaNovaHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createSambaNova>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Create the SambaNova provider using AI SDK
		this.provider = createSambaNova({
			baseURL: "https://api.sambanova.ai/v1",
			apiKey: options.sambaNovaApiKey ?? "not-provided",
			headers: DEFAULT_HEADERS,
		})
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = this.options.apiModelId ?? sambaNovaDefaultModelId
		const info = sambaNovaModels[id as keyof typeof sambaNovaModels] || sambaNovaModels[sambaNovaDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: SAMBANOVA_DEFAULT_TEMPERATURE,
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
	 * Process usage metrics from the AI SDK response.
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
			sambanova?: {
				promptCacheHitTokens?: number
				promptCacheMissTokens?: number
			}
		},
	): ApiStreamUsageChunk {
		// Extract cache metrics from SambaNova's providerMetadata if available
		const cacheReadTokens = providerMetadata?.sambanova?.promptCacheHitTokens ?? usage.details?.cachedInputTokens
		const cacheWriteTokens = providerMetadata?.sambanova?.promptCacheMissTokens

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
	 */
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { temperature, info } = this.getModel()
		const languageModel = this.getLanguageModel()

		// Convert messages to AI SDK format
		// For models that don't support multi-part content (like DeepSeek), flatten messages to string content
		// SambaNova's DeepSeek models expect string content, not array content
		const aiSdkMessages = convertToAiSdkMessages(messages, {
			transform: info.supportsImages ? undefined : flattenAiSdkMessagesToStringContent,
		})

		// Convert tools to OpenAI format first, then to AI SDK format
		const openAiTools = this.convertToolsForOpenAI(metadata?.tools)
		const aiSdkTools = convertToolsForAiSdk(openAiTools) as ToolSet | undefined

		// Build the request options
		const requestOptions: Parameters<typeof streamText>[0] = {
			model: languageModel,
			system: systemPrompt,
			messages: aiSdkMessages,
			temperature: this.options.modelTemperature ?? temperature ?? SAMBANOVA_DEFAULT_TEMPERATURE,
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
			throw handleAiSdkError(error, "SambaNova")
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
			temperature: this.options.modelTemperature ?? temperature ?? SAMBANOVA_DEFAULT_TEMPERATURE,
		})

		return text
	}
}
