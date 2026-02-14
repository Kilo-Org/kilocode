// kilocode_change - new file
import OpenAI from "openai"
import type Anthropic from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"
import { zenmuxDefaultModelId, zenmuxDefaultModelInfo } from "@roo-code/types"
import { ApiProviderError } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import type { OpenRouterReasoningParams } from "../transform/reasoning"
import { getModelParams } from "../transform/model-params"

import { getModels } from "./fetchers/modelCache"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"

import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { ChatCompletionTool } from "openai/resources"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { TOOL_PROTOCOL } from "@roo-code/types"
import { ApiStreamChunk } from "../transform/stream"
import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"
import { KiloCodeChunkSchema } from "./kilocode/chunk-schema"

// ZenMux provider parameters
type ZenMuxProviderParams = {
	order?: string[]
	only?: string[]
	allow_fallbacks?: boolean
	data_collection?: "allow" | "deny"
	sort?: "price" | "throughput" | "latency"
	zdr?: boolean
}

// ZenMux-specific response types
type ZenMuxChatCompletionParams = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "model"> & {
	model: string
	provider?: ZenMuxProviderParams
	reasoning?: OpenRouterReasoningParams
}

// ZenMux error structure
interface ZenMuxErrorResponse {
	message?: string
	code?: number
	metadata?: { raw?: string }
}

// Usage interface for cost calculation
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
	cost_details?: {
		upstream_inference_cost?: number
	}
}

const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.3

export class ZenMuxHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}
	protected endpoints: ModelRecord = {}
	lastGenerationId?: string

	protected get providerName(): "ZenMux" {
		return "ZenMux" as const
	}

	private currentReasoningDetails: any[] = []

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.zenmuxBaseUrl || "https://zenmux.ai/api/v1"
		const apiKey = this.options.zenmuxApiKey ?? "not-provided"

		this.client = new OpenAI({
			baseURL: baseURL,
			apiKey: apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})

		// Load models asynchronously to populate cache before getModel() is called
		this.loadDynamicModels().catch((error) => {
			console.error("[ZenMuxHandler] Failed to load dynamic models:", error)
		})
	}

	private async loadDynamicModels(): Promise<void> {
		try {
			const models = await getModels({ provider: "zenmux" })
			this.models = models
		} catch (error) {
			console.error("[ZenMuxHandler] Error loading dynamic models:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
		}
	}
	async createZenMuxStream(
		client: OpenAI,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		model: { id: string; info: ModelInfo },
		_reasoningEffort?: string,
		thinkingBudgetTokens?: number,
		zenMuxProviderSorting?: string,
		tools?: Array<ChatCompletionTool>,
		_geminiThinkingLevel?: string,
	) {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Build reasoning config if thinking budget is set
		let reasoning: { max_tokens: number } | undefined
		if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
			reasoning = { max_tokens: thinkingBudgetTokens }
		}

		// @ts-ignore-next-line
		const stream = await client.chat.completions.create({
			model: model.id,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning ? { reasoning } : {}),
			...(zenMuxProviderSorting && zenMuxProviderSorting !== ""
				? {
						provider: {
							routing: {
								type: "priority",
								primary_factor: zenMuxProviderSorting,
							},
						},
					}
				: {}),
			...this.getOpenAIToolParams(tools),
		})

		return stream
	}
	getOpenAIToolParams(tools?: ChatCompletionTool[], enableParallelToolCalls: boolean = false) {
		return tools?.length
			? {
					tools,
					tool_choice: tools ? "auto" : undefined,
					parallel_tool_calls: enableParallelToolCalls ? true : false,
				}
			: {
					tools: undefined,
				}
	}

	getTotalCost(lastUsage: CompletionUsage): number {
		return (lastUsage.cost_details?.upstream_inference_cost || 0) + (lastUsage.cost || 0)
	}

	private handleStreamingError(error: ZenMuxErrorResponse, modelId: string, operation: string): never {
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

		throw new Error(`ZenMux API Error ${error?.code}: ${rawErrorMessage}`)
	}
	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		this.lastGenerationId = undefined
		const model = await this.fetchModel()

		let { id: modelId } = model

		// Reset reasoning_details accumulator for this request
		this.currentReasoningDetails = []

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

		// Add cache breakpoints for supported models
		if (modelId.startsWith("anthropic/claude") || modelId.startsWith("google/gemini")) {
			if (modelId.startsWith("google")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}

		let stream
		try {
			stream = await this.createZenMuxStream(
				this.client,
				systemPrompt,
				messages,
				model,
				this.options.reasoningEffort,
				this.options.modelMaxThinkingTokens,
				this.options.zenmuxProviderSort,
				metadata?.tools,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "createMessage")
			TelemetryService.instance.captureException(apiError)
			throw error
		}

		let lastUsage: CompletionUsage | undefined = undefined
		let inferenceProvider: string | undefined
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
			// Handle ZenMux streaming error response
			if ("error" in chunk) {
				this.handleStreamingError(chunk.error as ZenMuxErrorResponse, modelId, "createMessage")
			}

			const kiloCodeChunk = KiloCodeChunkSchema.safeParse(chunk).data
			inferenceProvider =
				kiloCodeChunk?.choices?.[0]?.delta?.provider_metadata?.gateway?.routing?.resolvedProvider ??
				kiloCodeChunk?.provider ??
				inferenceProvider

			verifyFinishReason(chunk.choices[0])
			const delta = chunk.choices[0]?.delta
			const finishReason = chunk.choices[0]?.finish_reason

			if (delta) {
				// Handle reasoning_details array format
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

						if (reasoningText) {
							yield { type: "reasoning", text: reasoningText } as ApiStreamChunk
						}
					}
				} else if ("reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
					// Handle legacy reasoning format
					yield { type: "reasoning", text: delta.reasoning } as ApiStreamChunk
				}

				if (delta && "reasoning_content" in delta && typeof delta.reasoning_content === "string") {
					yield { type: "reasoning", text: delta.reasoning_content } as ApiStreamChunk
				}

				// Check for tool calls in delta
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
				totalCost: this.getTotalCost(lastUsage),
				inferenceProvider,
			}
		}
	}

	getReasoningDetails(): any[] | undefined {
		return this.currentReasoningDetails.length > 0 ? this.currentReasoningDetails : undefined
	}
	public async fetchModel() {
		const models = await getModels({ provider: "zenmux" })
		this.models = models
		return this.getModel()
	}

	override getModel() {
		const id = this.options.zenmuxModelId ?? zenmuxDefaultModelId
		let info = this.models[id] ?? zenmuxDefaultModelInfo

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "zenmux",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	async completePrompt(prompt: string) {
		let { id: modelId, maxTokens, temperature, reasoning, verbosity } = await this.fetchModel()

		// ZenMux `verbosity` supports "low" | "medium" | "high" (and sometimes null),
		// while our shared model params may include "max". Map "max" to the closest
		// supported value to satisfy the API/SDK typing.
		const zenMuxVerbosity: "low" | "medium" | "high" | null | undefined = verbosity === "max" ? "high" : verbosity

		const completionParams: ZenMuxChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			...(reasoning && { reasoning }),
			verbosity: zenMuxVerbosity,
		}

		let response

		try {
			response = await this.client.chat.completions.create(completionParams)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "completePrompt")
			TelemetryService.instance.captureException(apiError)
			throw error
		}

		if ("error" in response) {
			this.handleStreamingError(response.error as ZenMuxErrorResponse, modelId, "completePrompt")
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return completion.choices[0]?.message?.content || ""
	}
}
