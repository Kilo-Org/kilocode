import { Anthropic } from "@anthropic-ai/sdk"
import { createCerebras } from "@ai-sdk/cerebras"
import { streamText, generateText, ToolSet } from "ai"

import { cerebrasModels, cerebrasDefaultModelId, type CerebrasModelId, type ModelInfo } from "@roo-code/types"

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

// kilocode_change start
/**
 * Conservative max_tokens for Cerebras to avoid premature rate limiting.
 * Cerebras rate limiter estimates token consumption using max_completion_tokens upfront,
 * so requesting the model maximum (e.g., 64K) reserves that quota even if actual usage is low.
 * 8K is sufficient for most agentic tool use while preserving rate limit headroom.
 */
const CEREBRAS_DEFAULT_MAX_TOKENS = 8_192
const CEREBRAS_INTEGRATION_HEADER = "X-Cerebras-3rd-Party-Integration"
const CEREBRAS_INTEGRATION_NAME = "roocode"
const CEREBRAS_DEFAULT_TEMPERATURE = 0

/**
 * Cerebras provider using the dedicated @ai-sdk/cerebras package.
 * Provides high-speed inference powered by Wafer-Scale Engines.
 */
export class CerebrasHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createCerebras>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Create the Cerebras provider using AI SDK
		this.provider = createCerebras({
			apiKey: options.cerebrasApiKey ?? "not-provided",
			headers: {
				...DEFAULT_HEADERS,
				[CEREBRAS_INTEGRATION_HEADER]: CEREBRAS_INTEGRATION_NAME,
			},
		})
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = (this.options.apiModelId ?? cerebrasDefaultModelId) as CerebrasModelId
		const info = cerebrasModels[id as keyof typeof cerebrasModels] || cerebrasModels[cerebrasDefaultModelId]
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
	 * Process usage metrics from the AI SDK response.
	 */
	protected processUsageMetrics(usage: {
		inputTokens?: number
		outputTokens?: number
		details?: {
			cachedInputTokens?: number
			reasoningTokens?: number
		}
	}): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheReadTokens: usage.details?.cachedInputTokens,
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
			temperature: this.options.modelTemperature ?? temperature ?? CEREBRAS_DEFAULT_TEMPERATURE,
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

			// Yield usage metrics at the end
			const usage = await result.usage
			if (usage) {
				yield this.processUsageMetrics(usage)
			}
		} catch (error) {
			// Handle AI SDK errors (AI_RetryError, AI_APICallError, etc.)
			throw handleAiSdkError(error, "Cerebras")
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
			temperature: this.options.modelTemperature ?? temperature ?? CEREBRAS_DEFAULT_TEMPERATURE,
		})

		return text
	}
}
