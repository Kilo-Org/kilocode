import { Anthropic } from "@anthropic-ai/sdk"
import { createXai } from "@ai-sdk/xai"
import { streamText, generateText, ToolSet } from "ai"

import { type XAIModelId, xaiDefaultModelId, xaiModels, type ModelInfo } from "@roo-code/types"

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

const XAI_DEFAULT_TEMPERATURE = 0

/**
 * xAI provider using the dedicated @ai-sdk/xai package.
 * Provides native support for Grok models including reasoning models.
 */
export class XAIHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createXai>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Create the xAI provider using AI SDK
		this.provider = createXai({
			baseURL: "https://api.x.ai/v1",
			apiKey: options.xaiApiKey ?? "not-provided",
			headers: DEFAULT_HEADERS,
		})
	}

	override getModel(): {
		id: XAIModelId
		info: ModelInfo
		maxTokens?: number
		temperature?: number
		reasoning?: any
	} {
		const id =
			this.options.apiModelId && this.options.apiModelId in xaiModels
				? (this.options.apiModelId as XAIModelId)
				: xaiDefaultModelId

		const info = xaiModels[id]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: XAI_DEFAULT_TEMPERATURE,
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
			xai?: {
				cachedPromptTokens?: number
			}
		},
	): ApiStreamUsageChunk {
		// Extract cache metrics from xAI's providerMetadata if available
		// xAI supports prompt caching through prompt_tokens_details.cached_tokens
		const cacheReadTokens = providerMetadata?.xai?.cachedPromptTokens ?? usage.details?.cachedInputTokens

		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheReadTokens,
			cacheWriteTokens: undefined, // xAI doesn't report cache write tokens separately
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
		const { temperature, reasoning } = this.getModel()
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
			temperature: this.options.modelTemperature ?? temperature ?? XAI_DEFAULT_TEMPERATURE,
			maxOutputTokens: this.getMaxOutputTokens(),
			tools: aiSdkTools,
			toolChoice: mapToolChoice(metadata?.tool_choice),
			...(reasoning && { providerOptions: { xai: reasoning } }),
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
			throw handleAiSdkError(error, "xAI")
		}
	}

	/**
	 * Complete a prompt using the AI SDK generateText.
	 */
	async completePrompt(prompt: string): Promise<string> {
		const { temperature, reasoning } = this.getModel()
		const languageModel = this.getLanguageModel()

		try {
			const { text } = await generateText({
				model: languageModel,
				prompt,
				maxOutputTokens: this.getMaxOutputTokens(),
				temperature: this.options.modelTemperature ?? temperature ?? XAI_DEFAULT_TEMPERATURE,
				...(reasoning && { providerOptions: { xai: reasoning } }),
			})

			return text
		} catch (error) {
			throw handleAiSdkError(error, "xAI")
		}
	}
}
