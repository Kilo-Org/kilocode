import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	ApiProviderError,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { TOOL_PROTOCOL } from "@roo-code/types"
import { ApiStreamChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import type { OpenRouterReasoningParams } from "../transform/reasoning"
import { getModelParams } from "../transform/model-params"

import { getModels } from "./fetchers/modelCache"
import { getModelEndpoints } from "./fetchers/modelEndpointCache"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"

// kilocode_change start
type OpenRouterProviderParams = {
	order?: string[]
	only?: string[]
	allow_fallbacks?: boolean
	data_collection?: "allow" | "deny"
	sort?: "price" | "throughput" | "latency"
	zdr?: boolean
}

import { safeJsonParse } from "../../shared/safeJsonParse"
import { isAnyRecognizedKiloCodeError } from "../../shared/kilocode/errorUtils"
// kilocode_change end

import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { generateImageWithProvider, ImageGenerationResult } from "./utils/image-generation"
import { KiloCodeChunkSchema } from "./kilocode/chunk-schema"

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
	provider?: OpenRouterProviderParams // kilocode_change
}

// OpenRouter error structure that may include metadata.raw with actual upstream error
interface OpenRouterErrorResponse {
	message?: string
	code?: number
	metadata?: { raw?: string }
}

// See `OpenAI.Chat.Completions.ChatCompletionChunk["usage"]`
// `CompletionsAPI.CompletionUsage`
// See also: https://openrouter.ai/docs/use-cases/usage-accounting
export // kilocode_change
interface CompletionUsage {
	completion_tokens?: number
	completion_tokens_details?: {
		reasoning_tokens?: number
	}
	prompt_tokens?: number
	prompt_tokens_details?: {
		cached_tokens?: number
	}
	total_tokens?: number
	cost?: number
	is_byok?: boolean // kilocode_change
	cost_details?: {
		upstream_inference_cost?: number
	}
}

export class OpenRouterHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}
	protected endpoints: ModelRecord = {}

	// kilocode_change start property
	protected get providerName(): "OpenRouter" | "KiloCode" {
		return "OpenRouter" as const
	}
	// kilocode_change end
	private currentReasoningDetails: any[] = []

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"
		const apiKey = this.options.openRouterApiKey ?? "not-provided"

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: DEFAULT_HEADERS })

		// Load models asynchronously to populate cache before getModel() is called
		this.loadDynamicModels().catch((error) => {
			console.error("[OpenRouterHandler] Failed to load dynamic models:", error)
		})
	}

	private async loadDynamicModels(): Promise<void> {
		try {
			const [models, endpoints] = await Promise.all([
				getModels({ provider: "openrouter" }),
				getModelEndpoints({
					router: "openrouter",
					modelId: this.options.openRouterModelId,
					endpoint: this.options.openRouterSpecificProvider,
				}),
			])

			this.models = models
			this.endpoints = endpoints
		} catch (error) {
			console.error("[OpenRouterHandler] Error loading dynamic models:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
		}
	}

	// kilocode_change start
	customRequestOptions(_metadata?: ApiHandlerCreateMessageMetadata): { headers: Record<string, string> } | undefined {
		return undefined
	}

	getCustomRequestHeaders(taskId?: string) {
		return (taskId ? this.customRequestOptions({ taskId })?.headers : undefined) ?? {}
	}

	getTotalCost(lastUsage: CompletionUsage): number {
		return (lastUsage.cost_details?.upstream_inference_cost || 0) + (lastUsage.cost || 0)
	}

	getProviderParams(): { provider?: OpenRouterProviderParams } {
		if (this.options.openRouterSpecificProvider && this.endpoints[this.options.openRouterSpecificProvider]) {
			return {
				provider: {
					order: [this.options.openRouterSpecificProvider],
					only: [this.options.openRouterSpecificProvider],
					allow_fallbacks: false,
					data_collection: this.options.openRouterProviderDataCollection,
					zdr: this.options.openRouterZdr,
				},
			}
		}
		if (
			this.options.openRouterProviderDataCollection ||
			this.options.openRouterProviderSort ||
			this.options.openRouterZdr
		) {
			return {
				provider: {
					data_collection: this.options.openRouterProviderDataCollection,
					sort: this.options.openRouterProviderSort,
					zdr: this.options.openRouterZdr,
				},
			}
		}
		return {}
	}
	// kilocode_change end

	getReasoningDetails(): any[] | undefined {
		return this.currentReasoningDetails.length > 0 ? this.currentReasoningDetails : undefined
	}

	/**
	 * Handle OpenRouter streaming error response and report to telemetry.
	 * OpenRouter may include metadata.raw with the actual upstream provider error.
	 */
	private handleStreamingError(error: OpenRouterErrorResponse, modelId: string, operation: string): never {
		const rawErrorMessage = error?.metadata?.raw || error?.message

		const apiError = Object.assign(
			new ApiProviderError(
				rawErrorMessage ?? "Unknown error",
				this.providerName,
				modelId,
				operation,
				error?.code,
			),
			{ status: error?.code, error: { message: error?.message, metadata: error?.metadata } },
		)

		TelemetryService.instance.captureException(apiError)

		throw new Error(`OpenRouter API Error ${error?.code}: ${rawErrorMessage}`)
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		let { id: modelId, maxTokens, temperature, topP, reasoning } = model

		// Reset reasoning_details accumulator for this request
		this.currentReasoningDetails = []

		// OpenRouter sends reasoning tokens by default for Gemini 2.5 Pro models
		// even if you don't request them. This is not the default for
		// other providers (including Gemini), so we need to explicitly disable
		// them unless the user has explicitly configured reasoning.
		// Note: Gemini 3 models use reasoning_details format and should not be excluded.
		if (
			(modelId === "google/gemini-2.5-pro-preview" || modelId === "google/gemini-2.5-pro") &&
			typeof reasoning === "undefined"
		) {
			reasoning = { exclude: true }
		}

		// Convert Anthropic messages to OpenAI format.
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// DeepSeek highly recommends using user instead of system role.
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// Process reasoning_details when switching models to Gemini for native tool call compatibility
		const toolProtocol = resolveToolProtocol(this.options, model.info)
		const isNativeProtocol = toolProtocol === TOOL_PROTOCOL.NATIVE
		const isGemini = modelId.startsWith("google/gemini")

		// For Gemini with native protocol: inject fake reasoning.encrypted blocks for tool calls
		// This is required when switching from other models to Gemini to satisfy API validation
		if (isNativeProtocol && isGemini) {
			openAiMessages = openAiMessages.map((msg) => {
				if (msg.role === "assistant") {
					const toolCalls = (msg as any).tool_calls as any[] | undefined
					const existingDetails = (msg as any).reasoning_details as any[] | undefined

					// Only inject if there are tool calls and no existing encrypted reasoning
					if (toolCalls && toolCalls.length > 0) {
						const hasEncrypted = existingDetails?.some((d) => d.type === "reasoning.encrypted") ?? false

						if (!hasEncrypted) {
							const fakeEncrypted = toolCalls.map((tc, idx) => ({
								id: tc.id,
								type: "reasoning.encrypted",
								data: "skip_thought_signature_validator",
								format: "google-gemini-v1",
								index: (existingDetails?.length ?? 0) + idx,
							}))

							return {
								...msg,
								reasoning_details: [...(existingDetails ?? []), ...fakeEncrypted],
							}
						}
					}
				}
				return msg
			})
		}

		// https://openrouter.ai/docs/features/prompt-caching
		// TODO: Add a `promptCacheStratey` field to `ModelInfo`.
		if (
			modelId.startsWith("anthropic/claude") /* kilocode_change */ ||
			OPEN_ROUTER_PROMPT_CACHING_MODELS.has(modelId)
		) {
			if (modelId.startsWith("google")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}
		// kilocode_change end

		const transforms = (this.options.openRouterUseMiddleOutTransform ?? true) ? ["middle-out"] : undefined

		// https://openrouter.ai/docs/transforms
		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
			temperature,
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...this.getProviderParams(), // kilocode_change: original expression was moved into function
			parallel_tool_calls: false, // Ensure only one tool call at a time
			...(transforms && { transforms }),
			...(reasoning && { reasoning }),
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			verbosity: model.verbosity, // kilocode_change
		}

		// kilocode_change start
		const requestOptions = this.customRequestOptions(metadata) ?? { headers: {} }
		if (modelId.startsWith("anthropic/")) {
			requestOptions.headers["x-anthropic-beta"] =
				"fine-grained-tool-streaming-2025-05-14,structured-outputs-2025-11-13"
		}
		// kilocode_change end

		let stream
		try {
			stream = await this.client.chat.completions.create(completionParams, requestOptions)
		} catch (error) {
			// kilocode_change start
			// KiloCode backend errors are already user-readable and should be handled upstream.
			if (this.providerName === "KiloCode" && isAnyRecognizedKiloCodeError(error)) {
				throw error
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "createMessage")
			TelemetryService.instance.captureException(apiError)

			// Preserve existing readability improvements for user-facing errors.
			const readableMessage = makeOpenRouterErrorReadable(error)
			throw new Error(readableMessage)
			// kilocode_change end
		}

		let lastUsage: CompletionUsage | undefined = undefined
		let inferenceProvider: string | undefined // kilocode_change
		// Accumulator for reasoning_details: accumulate text by type-index key
		const reasoningDetailsAccumulator = new Map<
			string,
			{
				type: string
				text?: string
				summary?: string
				data?: string
				id?: string | null
				format?: string
				signature?: string
				index: number
			}
		>()

		for await (const chunk of stream) {
			// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
			if ("error" in chunk) {
				this.handleStreamingError(chunk.error as OpenRouterErrorResponse, modelId, "createMessage")
			}

			// kilocode_change start
			const kiloCodeChunk = KiloCodeChunkSchema.safeParse(chunk).data
			inferenceProvider =
				kiloCodeChunk?.choices?.[0]?.delta?.provider_metadata?.gateway?.routing?.resolvedProvider ??
				kiloCodeChunk?.provider ??
				inferenceProvider
			// kilocode_change end

			verifyFinishReason(chunk.choices[0]) // kilocode_change
			const delta = chunk.choices[0]?.delta
			const finishReason = chunk.choices[0]?.finish_reason

			if (delta) {
				// Handle reasoning_details array format (used by Gemini 3, Claude, OpenAI o-series, etc.)
				// See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
				// Priority: Check for reasoning_details first, as it's the newer format
				const deltaWithReasoning = delta as typeof delta & {
					reasoning_details?: Array<{
						type: string
						text?: string
						summary?: string
						data?: string
						id?: string | null
						format?: string
						signature?: string
						index?: number
					}>
				}

				if (deltaWithReasoning.reasoning_details && Array.isArray(deltaWithReasoning.reasoning_details)) {
					for (const detail of deltaWithReasoning.reasoning_details) {
						const index = detail.index ?? 0
						const key = `${detail.type}-${index}`
						const existing = reasoningDetailsAccumulator.get(key)

						if (existing) {
							// Accumulate text/summary/data for existing reasoning detail
							if (detail.text !== undefined) {
								existing.text = (existing.text || "") + detail.text
							}
							if (detail.summary !== undefined) {
								existing.summary = (existing.summary || "") + detail.summary
							}
							if (detail.data !== undefined) {
								existing.data = (existing.data || "") + detail.data
							}
							// Update other fields if provided
							if (detail.id !== undefined) existing.id = detail.id
							if (detail.format !== undefined) existing.format = detail.format
							if (detail.signature !== undefined) existing.signature = detail.signature
						} else {
							// Start new reasoning detail accumulation
							reasoningDetailsAccumulator.set(key, {
								type: detail.type,
								text: detail.text,
								summary: detail.summary,
								data: detail.data,
								id: detail.id,
								format: detail.format,
								signature: detail.signature,
								index,
							})
						}

						// Yield text for display (still fragmented for live streaming)
						let reasoningText: string | undefined
						if (detail.type === "reasoning.text" && typeof detail.text === "string") {
							reasoningText = detail.text
						} else if (detail.type === "reasoning.summary" && typeof detail.summary === "string") {
							reasoningText = detail.summary
						}
						// Note: reasoning.encrypted types are intentionally skipped as they contain redacted content

						if (reasoningText) {
							yield { type: "reasoning", text: reasoningText }
						}
					}
				} else if ("reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
					// Handle legacy reasoning format - only if reasoning_details is not present
					// See: https://openrouter.ai/docs/use-cases/reasoning-tokens
					yield { type: "reasoning", text: delta.reasoning }
				}

				// kilocode_change start
				if (delta && "reasoning_content" in delta && typeof delta.reasoning_content === "string") {
					yield { type: "reasoning", text: delta.reasoning_content }
				}
				// kilocode_change end

				// Check for tool calls in delta
				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if ("tool_calls" in delta && Array.isArray(delta.tool_calls)) {
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

				if (delta.content) {
					yield { type: "text", text: delta.content }
				}
			}

			// Process finish_reason to emit tool_call_end events
			// This ensures tool calls are finalized even if the stream doesn't properly close
			if (finishReason) {
				const endEvents = NativeToolCallParser.processFinishReason(finishReason)
				for (const event of endEvents) {
					yield event
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		// After streaming completes, store the accumulated reasoning_details
		if (reasoningDetailsAccumulator.size > 0) {
			this.currentReasoningDetails = Array.from(reasoningDetailsAccumulator.values())
		}

		if (lastUsage) {
			yield {
				type: "usage",
				inputTokens: lastUsage.prompt_tokens || 0,
				outputTokens: lastUsage.completion_tokens || 0,
				cacheReadTokens: lastUsage.prompt_tokens_details?.cached_tokens,
				reasoningTokens: lastUsage.completion_tokens_details?.reasoning_tokens,
				// kilocode_change start
				totalCost: this.getTotalCost(lastUsage),
				inferenceProvider,
				// kilocode_change end
			}
		}
	}

	public async fetchModel() {
		const [models, endpoints] = await Promise.all([
			getModels({ provider: "openrouter" }),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.openRouterModelId,
				endpoint: this.options.openRouterSpecificProvider,
			}),
		])

		this.models = models
		this.endpoints = endpoints

		return this.getModel()
	}

	override getModel() {
		const id = this.options.openRouterModelId ?? openRouterDefaultModelId
		let info = this.models[id] ?? openRouterDefaultModelInfo

		// If a specific provider is requested, use the endpoint for that provider.
		if (this.options.openRouterSpecificProvider && this.endpoints[this.options.openRouterSpecificProvider]) {
			info = this.endpoints[this.options.openRouterSpecificProvider]
		}

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	async completePrompt(prompt: string) {
		let {
			id: modelId,
			maxTokens,
			temperature,
			reasoning,
			verbosity, // kilocode_change
		} = await this.fetchModel()

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			...this.getProviderParams(), // kilocode_change: original expression was moved into function
			...(reasoning && { reasoning }),
			verbosity, // kilocode_change
		}

		// kilocode_change start
		const requestOptions = this.customRequestOptions() ?? { headers: {} }
		if (modelId.startsWith("anthropic/")) {
			requestOptions.headers["x-anthropic-beta"] =
				"fine-grained-tool-streaming-2025-05-14,structured-outputs-2025-11-13"
		}
		// kilocode_change end

		let response

		try {
			response = await this.client.chat.completions.create(completionParams, requestOptions)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "completePrompt")
			TelemetryService.instance.captureException(apiError)
			throw handleOpenAIError(error, this.providerName)
		}

		if ("error" in response) {
			this.handleStreamingError(response.error as OpenRouterErrorResponse, modelId, "completePrompt")
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return completion.choices[0]?.message?.content || ""
	}

	/**
	 * Generate an image using OpenRouter's image generation API (chat completions with modalities)
	 * Note: OpenRouter only supports the chat completions approach, not the /images/generations endpoint
	 * @param prompt The text prompt for image generation
	 * @param model The model to use for generation
	 * @param apiKey The OpenRouter API key (must be explicitly provided)
	 * @param inputImage Optional base64 encoded input image data URL
	 * @returns The generated image data and format, or an error
	 */
	async generateImage(
		prompt: string,
		model: string,
		apiKey: string,
		inputImage?: string,
		taskId?: string, // kilocode_change
	): Promise<ImageGenerationResult> {
		if (!apiKey) {
			return {
				success: false,
				error: "OpenRouter API key is required for image generation",
			}
		}

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"

		// OpenRouter only supports chat completions approach for image generation
		return generateImageWithProvider({
			baseURL,
			authToken: apiKey,
			model,
			prompt,
			inputImage,
			headers: { ...DEFAULT_HEADERS, ...this.getCustomRequestHeaders(taskId) }, // kilocode_change
		})
	}
}

// kilocode_change start
function makeOpenRouterErrorReadable(error: any) {
	const metadata = error?.error?.metadata as { raw?: string; provider_name?: string } | undefined
	const parsedJson = safeJsonParse(metadata?.raw)
	const rawError = parsedJson as
		| { error?: string & { message?: string }; detail?: string; message?: string }
		| undefined

	if (error?.code !== 429 && error?.code !== 418) {
		const errorMessage =
			rawError?.error?.message ??
			rawError?.error ??
			rawError?.detail ??
			rawError?.message ??
			metadata?.raw ??
			error?.message
		throw new Error(`${metadata?.provider_name ?? "Provider"} error: ${errorMessage ?? "unknown error"}`)
	}

	try {
		const parsedJson = JSON.parse(error.error.metadata?.raw)
		const retryAfter = parsedJson?.error?.details.map((detail: any) => detail.retryDelay).filter((r: any) => r)[0]
		if (retryAfter) {
			return `Rate limit exceeded, try again in ${retryAfter}.`
		}
	} catch (e) {}

	return `Rate limit exceeded, try again later.\n${error?.message || error}`
}
// kilocode_change end
