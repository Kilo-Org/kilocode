/**
 * OpenAI-compatible provider base class using Vercel AI SDK.
 * This provides a parallel implementation to OpenAiHandler using @ai-sdk/openai-compatible.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText, generateText, LanguageModel, ToolSet } from "ai"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { convertToAiSdkMessages, convertToolsForAiSdk, processAiSdkStreamPart } from "../transform/ai-sdk"
import { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "../transform/stream"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

type StreamTextProviderOptions = Parameters<typeof streamText>[0]["providerOptions"]

/**
 * Configuration options for creating an OpenAI-compatible provider.
 */
export interface OpenAICompatibleConfig {
	/** Provider name for identification */
	providerName: string
	/** Base URL for the API endpoint */
	baseURL: string
	/** API key for authentication */
	apiKey: string
	/** Model ID to use */
	modelId: string
	/** Model information */
	modelInfo: ModelInfo
	/** Optional custom headers */
	headers?: Record<string, string>
	/** Whether to include max_tokens in requests (default: false uses max_completion_tokens) */
	useMaxTokens?: boolean
	/** User-configured max tokens override */
	modelMaxTokens?: number
	/** Temperature setting */
	temperature?: number
}

/**
 * Base class for OpenAI-compatible API providers using Vercel AI SDK.
 * Extends BaseProvider and implements SingleCompletionHandler.
 */
export abstract class OpenAICompatibleHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected config: OpenAICompatibleConfig
	protected provider: ReturnType<typeof createOpenAICompatible>

	constructor(options: ApiHandlerOptions, config: OpenAICompatibleConfig) {
		super()
		this.options = options
		this.config = config

		// Create the OpenAI-compatible provider using AI SDK
		this.provider = createOpenAICompatible({
			name: config.providerName,
			baseURL: config.baseURL,
			apiKey: config.apiKey,
			headers: {
				...DEFAULT_HEADERS,
				...(config.headers || {}),
			},
		})
	}

	/**
	 * Get the language model for the configured model ID.
	 */
	protected getLanguageModel(): LanguageModel {
		return this.provider(this.config.modelId)
	}

	/**
	 * Get the model information. Must be implemented by subclasses.
	 */
	abstract override getModel(): { id: string; info: ModelInfo; maxTokens?: number; temperature?: number }

	/**
	 * Process usage metrics from the AI SDK response.
	 * Can be overridden by subclasses to handle provider-specific usage formats.
	 */
	protected processUsageMetrics(usage: {
		inputTokens?: number
		outputTokens?: number
		details?: {
			cachedInputTokens?: number
			reasoningTokens?: number
		}
		raw?: Record<string, unknown>
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
		toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
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
		const modelInfo = this.config.modelInfo
		const maxTokens = this.config.modelMaxTokens || modelInfo.maxTokens

		return maxTokens ?? undefined
	}

	// kilocode_change start
	/**
	 * Get the temperature to use for a request.
	 * Subclasses can override this to enforce provider/model-specific behavior.
	 */
	protected getRequestTemperature(model: { temperature?: number }): number | undefined {
		return model.temperature ?? this.config.temperature ?? 0
	}

	/**
	 * Get provider-specific AI SDK options.
	 * Subclasses can override this to pass provider-specific request fields.
	 */
	protected getProviderOptions(
		_model: { id: string; info: ModelInfo },
		_metadata?: ApiHandlerCreateMessageMetadata,
	): StreamTextProviderOptions {
		return undefined
	}
	// kilocode_change end

	/**
	 * Create a message stream using the AI SDK.
	 */
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = this.getModel()
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
			temperature: this.getRequestTemperature(model),
			maxOutputTokens: this.getMaxOutputTokens(),
			tools: aiSdkTools,
			toolChoice: this.mapToolChoice(metadata?.tool_choice),
			// kilocode_change
			providerOptions: this.getProviderOptions(model, metadata),
		}

		// Use streamText for streaming responses
		const result = streamText(requestOptions)

		// kilocode_change start
		// Moonshot/Kimi can stream tool calls as tool-input-* events without a final tool-call event.
		// Accumulate these events and emit a complete tool_call chunk so Task can execute tools reliably.
		const pendingToolInputs = new Map<string, { toolName: string; input: string }>()
		const emittedToolCallIds = new Set<string>()

		const emitToolCallFromPendingInput = (toolCallId: string): ApiStreamChunk | undefined => {
			if (emittedToolCallIds.has(toolCallId)) {
				pendingToolInputs.delete(toolCallId)
				return undefined
			}

			const pending = pendingToolInputs.get(toolCallId)
			pendingToolInputs.delete(toolCallId)

			emittedToolCallIds.add(toolCallId)

			return {
				type: "tool_call",
				id: toolCallId,
				name: pending?.toolName || "unknown_tool",
				arguments: pending?.input || "{}",
			}
		}
		// kilocode_change end

		// Process the full stream to get all events
		for await (const part of result.fullStream) {
			// kilocode_change start
			if (part.type === "tool-input-start") {
				const existing = pendingToolInputs.get(part.id)
				pendingToolInputs.set(part.id, {
					toolName: part.toolName || existing?.toolName || "unknown_tool",
					input: existing?.input || "",
				})
				continue
			}

			if (part.type === "tool-input-delta") {
				const existing = pendingToolInputs.get(part.id)
				pendingToolInputs.set(part.id, {
					toolName: existing?.toolName || "unknown_tool",
					input: (existing?.input || "") + part.delta,
				})
				continue
			}

			if (part.type === "tool-input-end") {
				const toolCallChunk = emitToolCallFromPendingInput(part.id)
				if (toolCallChunk) {
					yield toolCallChunk
				}
				continue
			}

			if (part.type === "tool-call") {
				if (emittedToolCallIds.has(part.toolCallId)) {
					continue
				}
				emittedToolCallIds.add(part.toolCallId)
				pendingToolInputs.delete(part.toolCallId)
			}
			// kilocode_change end

			// Use the processAiSdkStreamPart utility to convert stream parts
			for (const chunk of processAiSdkStreamPart(part)) {
				yield chunk
			}
		}

		// kilocode_change start
		// Flush any unfinished tool-input streams at end-of-stream.
		for (const toolCallId of pendingToolInputs.keys()) {
			const toolCallChunk = emitToolCallFromPendingInput(toolCallId)
			if (toolCallChunk) {
				yield toolCallChunk
			}
		}
		// kilocode_change end

		// Yield usage metrics at the end
		const usage = await result.usage
		if (usage) {
			yield this.processUsageMetrics(usage)
		}
	}

	/**
	 * Complete a prompt using the AI SDK generateText.
	 */
	async completePrompt(prompt: string): Promise<string> {
		const languageModel = this.getLanguageModel()
		const model = this.getModel()

		const { text } = await generateText({
			model: languageModel,
			prompt,
			maxOutputTokens: this.getMaxOutputTokens(),
			temperature: this.getRequestTemperature(model),
			// kilocode_change
			providerOptions: this.getProviderOptions(model),
		})

		return text
	}
}
