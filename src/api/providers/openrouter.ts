import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { z } from "zod"

import {
	type ModelRecord,
	ApiProviderError,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"

import type { ApiHandlerOptions } from "../../shared/api"

import {
	convertToOpenAiMessages,
	sanitizeGeminiMessages,
	consolidateReasoningDetails,
} from "../transform/openai-format"
import { normalizeMistralToolCallId } from "../transform/mistral-format"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { TOOL_PROTOCOL } from "@roo-code/types"
import { ApiStreamChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { addAnthropicCacheBreakpoints } from "../transform/caching/kilocode" // kilocode_change: own implementation that supports tool results
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
	allow_fallbacks?: boolean
	data_collection?: "allow" | "deny"
	sort?: "price" | "throughput" | "latency"
	zdr?: boolean
}

import { safeJsonParse } from "@roo-code/core" // kilocode_change
import { isAnyRecognizedKiloCodeError } from "../../shared/kilocode/errorUtils"
import { OpenAIError } from "openai"
// kilocode_change end

import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { generateImageWithProvider, ImageGenerationResult } from "./utils/image-generation"
import { KiloCodeChunkSchema } from "./kilocode/chunk-schema"
import { applyRouterToolPreferences } from "./utils/router-tool-preferences"

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
	provider?: OpenRouterProviderParams // kilocode_change
}

// Zod schema for OpenRouter error response structure (for caught exceptions)
const OpenRouterErrorResponseSchema = z.object({
	error: z
		.object({
			message: z.string().optional(),
			code: z.number().optional(),
			metadata: z
				.object({
					raw: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
})

// OpenRouter error structure that may include error.metadata.raw with actual upstream error
// This is for caught exceptions which have the error wrapped in an "error" property
interface OpenRouterErrorResponse {
	error?: {
		message?: string
		code?: number
		metadata?: { raw?: string }
	}
}

// Direct error object structure (for streaming errors passed directly)
interface OpenRouterError {
	message?: string
	code?: number
	metadata?: { raw?: string }
}

/**
 * Helper function to parse and extract error message from metadata.raw
 * metadata.raw is often a JSON encoded string that may contain .message or .error fields
 * Example structures:
 * - {"message": "Error text"}
 * - {"error": "Error text"}
 * - {"error": {"message": "Error text"}}
 * - {"type":"error","error":{"type":"invalid_request_error","message":"tools: Tool names must be unique."}}
 */
function extractErrorFromMetadataRaw(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined
	}

	try {
		const parsed = JSON.parse(raw)
		// Check for common error message fields
		if (typeof parsed === "object" && parsed !== null) {
			// Check for direct message field
			if (typeof parsed.message === "string") {
				return parsed.message
			}
			// Check for nested error.message field (e.g., Anthropic error format)
			if (typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
				return parsed.error.message
			}
			// Check for error as a string
			if (typeof parsed.error === "string") {
				return parsed.error
			}
		}
		// If we can't extract a specific field, return the raw string
		return raw
	} catch {
		// If it's not valid JSON, return as-is
		return raw
	}
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
					data_collection: this.options.openRouterProviderDataCollection,
					sort: this.options.openRouterProviderSort,
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
	 * @param error The error object (not wrapped - receives the error directly)
	 */
	private handleStreamingError(error: OpenRouterError, modelId: string, operation: string): never {
		const rawString = error?.metadata?.raw
		const parsedError = extractErrorFromMetadataRaw(rawString)
		const rawErrorMessage = parsedError || error?.message || "Unknown error"

		const apiError = Object.assign(
			new ApiProviderError(rawErrorMessage, this.providerName, modelId, operation, error?.code),
			{ status: error?.code, error },
		)

		TelemetryService.instance.captureException(apiError)

		throw new Error(`OpenRouter API Error ${error?.code}: ${rawErrorMessage}`)
	}

	// kilocode_change start
	// the comment below seems incorrect, errors in the stream are still thrown as exceptions
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		try {
			yield* this.createMessage_implementationRenamedForKilocode(systemPrompt, messages, metadata)
		} catch (error) {
			if (
				error instanceof OpenAIError &&
				(this.providerName !== "KiloCode" || !isAnyRecognizedKiloCodeError(error))
			) {
				throw new Error(makeOpenRouterErrorReadable(error))
			}
			throw error
		}
	}
	// kilocode_change end

	private async *createMessage_implementationRenamedForKilocode(
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
		// Note: Gemini 3 models use reasoning_details format with thought signatures,
		// but we handle this via skip_thought_signature_validator injection below.
		if (
			(modelId === "google/gemini-2.5-pro-preview" || modelId === "google/gemini-2.5-pro") &&
			typeof reasoning === "undefined"
		) {
			reasoning = { exclude: true }
		}

		// Convert Anthropic messages to OpenAI format.
		// Pass normalization function for Mistral compatibility (requires 9-char alphanumeric IDs)
		const isMistral = modelId.toLowerCase().includes("mistral")
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(
				messages,
				isMistral ? { normalizeToolCallId: normalizeMistralToolCallId } : undefined,
			),
		]

		// DeepSeek highly recommends using user instead of system role.
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// Process reasoning_details when switching models to Gemini for native tool call compatibility
		// IMPORTANT: Use metadata.toolProtocol if provided (task's locked protocol) for consistency
		const toolProtocol = resolveToolProtocol(this.options, model.info, metadata?.toolProtocol)
		const isNativeProtocol = toolProtocol === TOOL_PROTOCOL.NATIVE
		const isGemini = modelId.startsWith("google/gemini")

		// For Gemini models with native protocol:
		// 1. Sanitize messages to handle thought signature validation issues.
		//    This must happen BEFORE fake encrypted block injection to avoid injecting for
		//    tool calls that will be dropped due to missing/mismatched reasoning_details.
		// 2. Inject fake reasoning.encrypted block for tool calls without existing encrypted reasoning.
		//    This is required when switching from other models to Gemini to satisfy API validation.
		//    Per OpenRouter documentation (conversation with Toven, Nov 2025):
		//    - Create ONE reasoning_details entry per assistant message with tool calls
		//    - Set `id` to the FIRST tool call's ID from the tool_calls array
		//    - Set `data` to "skip_thought_signature_validator" to bypass signature validation
		//    - Set `index` to 0
		// See: https://github.com/cline/cline/issues/8214
		if (isNativeProtocol && isGemini) {
			// Step 1: Sanitize messages - filter out tool calls with missing/mismatched reasoning_details
			openAiMessages = sanitizeGeminiMessages(openAiMessages, modelId)

			// Step 2: Inject fake reasoning.encrypted block for tool calls that survived sanitization
			openAiMessages = openAiMessages.map((msg) => {
				if (msg.role === "assistant") {
					const toolCalls = (msg as any).tool_calls as any[] | undefined
					const existingDetails = (msg as any).reasoning_details as any[] | undefined

					// Only inject if there are tool calls and no existing encrypted reasoning
					if (toolCalls && toolCalls.length > 0) {
						const hasEncrypted = existingDetails?.some((d) => d.type === "reasoning.encrypted") ?? false

						if (!hasEncrypted) {
							// Create ONE fake encrypted block with the FIRST tool call's ID
							// This is the documented format from OpenRouter for skipping thought signature validation
							const fakeEncrypted = {
								type: "reasoning.encrypted",
								data: "skip_thought_signature_validator",
								id: toolCalls[0].id,
								format: "google-gemini-v1",
								index: 0,
							}

							return {
								...msg,
								reasoning_details: [...(existingDetails ?? []), fakeEncrypted],
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
			...(reasoning && { reasoning }),
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			verbosity: model.verbosity === "max" ? "high" : model.verbosity, // kilocode_change
		}

		// kilocode_change start
		const requestOptions = this.customRequestOptions(metadata) ?? { headers: {} }
		if (modelId.startsWith("anthropic/")) {
			requestOptions.headers["x-anthropic-beta"] = "fine-grained-tool-streaming-2025-05-14"
		}
		// kilocode_change end

		let stream
		try {
			// kilocode_change start
			let attempts = 0
			while (true) {
				try {
					attempts++
					stream = await this.client.chat.completions.create(completionParams, requestOptions)
					break
				} catch (error: any) {
					const msg = error?.message || ""
					const isBedrockNetworkError =
						msg.includes("Amazon Bedrock error") && msg.includes("Network connection lost")

					if (isBedrockNetworkError && attempts < 3) {
						console.log(`[OpenRouter] Retrying Bedrock network error (attempt ${attempts}/3): ${msg}`)
						await new Promise((resolve) => setTimeout(resolve, attempts * 2000))
						continue
					}
					throw error
				}
			}
			// kilocode_change end
		} catch (error) {
			// kilocode_change start
			// KiloCode backend errors are already user-readable and should be handled upstream.
			if (this.providerName === "KiloCode" && isAnyRecognizedKiloCodeError(error)) {
				throw error
			}
			// kilocode_change end

			// Try to parse as OpenRouter error structure using Zod
			const parseResult = OpenRouterErrorResponseSchema.safeParse(error)

			if (parseResult.success && parseResult.data.error) {
				const openRouterError = parseResult.data
				const rawString = openRouterError.error?.metadata?.raw
				const parsedError = extractErrorFromMetadataRaw(rawString)
				const rawErrorMessage = parsedError || openRouterError.error?.message || "Unknown error"

				const apiError = Object.assign(
					new ApiProviderError(
						rawErrorMessage,
						this.providerName,
						modelId,
						"createMessage",
						openRouterError.error?.code,
					),
					{
						status: openRouterError.error?.code,
						error: openRouterError.error,
					},
				)

				TelemetryService.instance.captureException(apiError)
				throw handleOpenAIError(error, this.providerName)
			} else {
				// Fallback for non-OpenRouter errors
				const errorMessage = error instanceof Error ? error.message : String(error)
				const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "createMessage")
				TelemetryService.instance.captureException(apiError)
				throw handleOpenAIError(error, this.providerName)
			}
		}

		let lastUsage: CompletionUsage | undefined = undefined
		let inferenceProvider: string | undefined // kilocode_change
		// Accumulator for reasoning_details FROM the API.
		// We preserve the original shape of reasoning_details to prevent malformed responses.
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

		// Track whether we've yielded displayable text from reasoning_details.
		// When reasoning_details has displayable content (reasoning.text or reasoning.summary),
		// we skip yielding the top-level reasoning field to avoid duplicate display.
		let hasYieldedReasoningFromDetails = false

		for await (const chunk of stream) {
			// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
			if ("error" in chunk) {
				this.handleStreamingError(chunk.error as OpenRouterError, modelId, "createMessage")
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
						// Only reasoning.text and reasoning.summary have displayable content
						// reasoning.encrypted is intentionally skipped as it contains redacted content
						let reasoningText: string | undefined
						if (detail.type === "reasoning.text" && typeof detail.text === "string") {
							reasoningText = detail.text
						} else if (detail.type === "reasoning.summary" && typeof detail.summary === "string") {
							reasoningText = detail.summary
						}

						if (reasoningText) {
							hasYieldedReasoningFromDetails = true
							yield { type: "reasoning", text: reasoningText }
						}
					}
				}

				// Handle top-level reasoning field for UI display.
				// Skip if we've already yielded from reasoning_details to avoid duplicate display.
				if ("reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
					if (!hasYieldedReasoningFromDetails) {
						yield { type: "reasoning", text: delta.reasoning }
					}
				}
				// kilocode_change start
				else if ("reasoning_content" in delta && typeof delta.reasoning_content === "string") {
					if (!hasYieldedReasoningFromDetails) {
						yield { type: "reasoning", text: delta.reasoning_content }
					}
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

		// After streaming completes, consolidate and store reasoning_details from the API.
		// This filters out corrupted encrypted blocks (missing `data`) and consolidates by index.
		if (reasoningDetailsAccumulator.size > 0) {
			const rawDetails = Array.from(reasoningDetailsAccumulator.values())
			this.currentReasoningDetails = consolidateReasoningDetails(rawDetails)
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

		// Apply tool preferences for models accessed through routers (OpenAI, Gemini)
		info = applyRouterToolPreferences(id, info)

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
			verbosity: verbosity === "max" ? "high" : verbosity, // kilocode_change
		}

		// kilocode_change start
		const requestOptions = this.customRequestOptions() ?? { headers: {} }
		if (modelId.startsWith("anthropic/")) {
			requestOptions.headers["x-anthropic-beta"] = "fine-grained-tool-streaming-2025-05-14"
		}
		// kilocode_change end

		let response

		try {
			response = await this.client.chat.completions.create(completionParams, requestOptions)
		} catch (error) {
			// Try to parse as OpenRouter error structure using Zod
			const parseResult = OpenRouterErrorResponseSchema.safeParse(error)

			if (parseResult.success && parseResult.data.error) {
				const openRouterError = parseResult.data
				const rawString = openRouterError.error?.metadata?.raw
				const parsedError = extractErrorFromMetadataRaw(rawString)
				const rawErrorMessage = parsedError || openRouterError.error?.message || "Unknown error"

				const apiError = Object.assign(
					new ApiProviderError(
						rawErrorMessage,
						this.providerName,
						modelId,
						"completePrompt",
						openRouterError.error?.code,
					),
					{
						status: openRouterError.error?.code,
						error: openRouterError.error,
					},
				)

				TelemetryService.instance.captureException(apiError)
				throw handleOpenAIError(error, this.providerName)
			} else {
				// Fallback for non-OpenRouter errors
				const errorMessage = error instanceof Error ? error.message : String(error)
				const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "completePrompt")
				TelemetryService.instance.captureException(apiError)
				throw handleOpenAIError(error, this.providerName)
			}
		}

		if ("error" in response) {
			this.handleStreamingError(response.error as OpenRouterError, modelId, "completePrompt")
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
		return `${metadata?.provider_name ?? "Provider"} error: ${errorMessage ?? "unknown error"}`
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
