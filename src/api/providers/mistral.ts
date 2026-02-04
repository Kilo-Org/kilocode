import { Anthropic } from "@anthropic-ai/sdk"
import { createMistral } from "@ai-sdk/mistral"
import { streamText, generateText, ToolSet, LanguageModel } from "ai"

import {
	mistralModels,
	mistralDefaultModelId,
	type MistralModelId,
	type ModelInfo,
	MISTRAL_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import {
	convertToAiSdkMessages,
	convertToolsForAiSdk,
	processAiSdkStreamPart,
	handleAiSdkError,
} from "../transform/ai-sdk"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { DEFAULT_HEADERS } from "./constants" // kilocode_change
import { streamSse } from "../../services/continuedev/core/fetch/stream" // kilocode_change
import type { CompletionUsage } from "./openrouter" // kilocode_change
import type { FimHandler } from "./kilocode/FimHandler" // kilocode_change

/**
 * Mistral provider using the dedicated @ai-sdk/mistral package.
 * Provides access to Mistral AI models including Codestral, Mistral Large, and more.
 */
export class MistralHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected provider: ReturnType<typeof createMistral>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const modelId = options.apiModelId ?? mistralDefaultModelId

		// Determine the base URL based on the model (Codestral uses a different endpoint)
		const baseURL = modelId.startsWith("codestral-")
			? options.mistralCodestralUrl || "https://codestral.mistral.ai/v1"
			: "https://api.mistral.ai/v1"

		// Create the Mistral provider using AI SDK
		this.provider = createMistral({
			apiKey: options.mistralApiKey ?? "not-provided",
			baseURL,
			headers: DEFAULT_HEADERS,
		})
	}

	override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number } {
		const id = (this.options.apiModelId ?? mistralDefaultModelId) as MistralModelId
		const info = mistralModels[id as keyof typeof mistralModels] || mistralModels[mistralDefaultModelId]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	/**
	 * Get the language model for the configured model ID.
	 */
	protected getLanguageModel(): LanguageModel {
		const { id } = this.getModel()
		// Type assertion needed due to version mismatch between @ai-sdk/mistral and ai packages
		return this.provider(id) as unknown as LanguageModel
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
	 * Map OpenAI tool_choice to AI SDK toolChoice format.
	 */
	protected mapToolChoice(
		toolChoice: any,
	): "auto" | "none" | "required" | { type: "tool"; toolName: string } | undefined {
		if (!toolChoice) {
			return undefined
		}

		// Handle string values
		if (typeof toolChoice === "string") {
			switch (toolChoice) {
				case "auto":
					return "auto"
				case "none":
					return "none"
				case "required":
				case "any":
					return "required"
				default:
					return "auto"
			}
		}

		// Handle object values (OpenAI ChatCompletionNamedToolChoice format)
		if (typeof toolChoice === "object" && "type" in toolChoice) {
			if (toolChoice.type === "function" && "function" in toolChoice && toolChoice.function?.name) {
				return { type: "tool", toolName: toolChoice.function.name }
			}
		}

		return undefined
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
		const languageModel = this.getLanguageModel()

		// Convert messages to AI SDK format
		const aiSdkMessages = convertToAiSdkMessages(messages)

		// Convert tools to OpenAI format first, then to AI SDK format
		const openAiTools = this.convertToolsForOpenAI(metadata?.tools)
		const aiSdkTools = convertToolsForAiSdk(openAiTools) as ToolSet | undefined

		// Build the request options
		// Use MISTRAL_DEFAULT_TEMPERATURE (1) as fallback to match original behavior
		const requestOptions: Parameters<typeof streamText>[0] = {
			model: languageModel,
			system: systemPrompt,
			messages: aiSdkMessages,
			temperature: this.options.modelTemperature ?? MISTRAL_DEFAULT_TEMPERATURE,
			maxOutputTokens: this.getMaxOutputTokens(),
			tools: aiSdkTools,
			toolChoice: this.mapToolChoice(metadata?.tool_choice),
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
			throw handleAiSdkError(error, "Mistral")
		}
	}

	/**
	 * Complete a prompt using the AI SDK generateText.
	 */
	async completePrompt(prompt: string): Promise<string> {
		const languageModel = this.getLanguageModel()

		// Use MISTRAL_DEFAULT_TEMPERATURE (1) as fallback to match original behavior
		const { text } = await generateText({
			model: languageModel,
			prompt,
			maxOutputTokens: this.getMaxOutputTokens(),
			temperature: this.options.modelTemperature ?? MISTRAL_DEFAULT_TEMPERATURE,
		})

		return text
	}

	// kilocode_change start
	fimSupport(): FimHandler | undefined {
		const modelId = this.options.apiModelId ?? mistralDefaultModelId
		if (!modelId.startsWith("codestral-")) {
			return undefined
		}

		return {
			streamFim: this.streamFim.bind(this),
			getModel: () => this.getModel(),
			getTotalCost: (usage: CompletionUsage) => {
				// Calculate cost based on model pricing
				const { info } = this.getModel()
				const inputCost = ((usage.prompt_tokens ?? 0) / 1_000_000) * (info.inputPrice ?? 0)
				const outputCost = ((usage.completion_tokens ?? 0) / 1_000_000) * (info.outputPrice ?? 0)
				return inputCost + outputCost
			},
		}
	}

	private async *streamFim(
		prefix: string,
		suffix: string,
		_taskId?: string,
		onUsage?: (usage: CompletionUsage) => void,
	): AsyncGenerator<string> {
		const { id: model, maxTokens } = this.getModel()

		// Get the base URL for the model
		// copy pasted from constructor, be sure to keep in sync
		const baseUrl = model.startsWith("codestral-")
			? this.options.mistralCodestralUrl || "https://codestral.mistral.ai"
			: "https://api.mistral.ai"

		const endpoint = new URL("v1/fim/completions", baseUrl)

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${this.options.mistralApiKey}`,
		}

		// temperature: 0.2 is mentioned as a sane example in mistral's docs
		const temperature = 0.2
		const requestMaxTokens = 256

		const response = await fetch(endpoint, {
			method: "POST",
			body: JSON.stringify({
				model,
				prompt: prefix,
				suffix,
				max_tokens: Math.min(requestMaxTokens, maxTokens ?? requestMaxTokens),
				temperature,
				stream: true,
			}),
			headers,
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`FIM streaming failed: ${response.status} ${response.statusText} - ${errorText}`)
		}

		for await (const data of streamSse(response)) {
			const content = data.choices?.[0]?.delta?.content
			if (content) {
				yield content
			}

			// Call usage callback when available
			// Note: Mistral FIM API returns usage in the final chunk with prompt_tokens and completion_tokens
			if (data.usage && onUsage) {
				onUsage({
					prompt_tokens: data.usage.prompt_tokens,
					completion_tokens: data.usage.completion_tokens,
					total_tokens: data.usage.total_tokens,
				})
			}
		}
	}
	// kilocode_change end
}
