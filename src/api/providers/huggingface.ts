import { Anthropic } from "@anthropic-ai/sdk"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText, generateText, ToolSet } from "ai"

import type { ModelRecord, ModelInfo } from "@roo-code/types"

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
import { getHuggingFaceModels, getCachedHuggingFaceModels } from "./fetchers/huggingface"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

const HUGGINGFACE_DEFAULT_TEMPERATURE = 0.7

/**
 * HuggingFace provider using @ai-sdk/openai-compatible for OpenAI-compatible API.
 * Uses HuggingFace's OpenAI-compatible endpoint to enable tool message support.
 * @see https://github.com/vercel/ai/issues/10766 - Workaround for tool messages not supported in @ai-sdk/huggingface
 */
export class HuggingFaceHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createOpenAICompatible>
	private modelCache: ModelRecord | null = null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		if (!this.options.huggingFaceApiKey) {
			throw new Error("Hugging Face API key is required")
		}

		// Create an OpenAI-compatible provider pointing to HuggingFace's /v1 endpoint
		// This fixes "tool messages not supported" error - the HuggingFace SDK doesn't
		// properly handle function_call_output format, but OpenAI SDK does
		this.provider = createOpenAICompatible({
			name: "huggingface",
			baseURL: "https://router.huggingface.co/v1",
			apiKey: this.options.huggingFaceApiKey,
			headers: DEFAULT_HEADERS,
		})

		// Try to get cached models first
		this.modelCache = getCachedHuggingFaceModels()

		// Fetch models asynchronously
		this.fetchModels()
	}

	private async fetchModels() {
		try {
			this.modelCache = await getHuggingFaceModels()
		} catch (error) {
			console.error("Failed to fetch HuggingFace models:", error)
		}
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = this.options.huggingFaceModelId || "meta-llama/Llama-3.3-70B-Instruct"

		// Try to get model info from cache
		const cachedInfo = this.modelCache?.[id]

		const info: ModelInfo = cachedInfo || {
			maxTokens: 8192,
			contextWindow: 131072,
			supportsImages: false,
			supportsPromptCache: false,
		}

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: HUGGINGFACE_DEFAULT_TEMPERATURE,
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
			huggingface?: {
				promptCacheHitTokens?: number
				promptCacheMissTokens?: number
			}
		},
	): ApiStreamUsageChunk {
		// Extract cache metrics from HuggingFace's providerMetadata if available
		const cacheReadTokens = providerMetadata?.huggingface?.promptCacheHitTokens ?? usage.details?.cachedInputTokens
		const cacheWriteTokens = providerMetadata?.huggingface?.promptCacheMissTokens

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
			temperature: this.options.modelTemperature ?? temperature ?? HUGGINGFACE_DEFAULT_TEMPERATURE,
			maxOutputTokens: this.getMaxOutputTokens(),
			tools: aiSdkTools,
			toolChoice: mapToolChoice(metadata?.tool_choice),
		}

		// Use streamText for streaming responses
		const result = streamText(requestOptions)

		try {
			// Process the full stream to get all events
			for await (const part of result.fullStream) {
				// Use the processAiSdkStreamPart utility to convert stream parts
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
			throw handleAiSdkError(error, "HuggingFace")
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
			temperature: this.options.modelTemperature ?? temperature ?? HUGGINGFACE_DEFAULT_TEMPERATURE,
		})

		return text
	}
}
