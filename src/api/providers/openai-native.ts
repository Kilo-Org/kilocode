import * as os from "os"
import { v7 as uuidv7 } from "uuid"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { Package } from "../../shared/package"
import {
	type ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
	OPENAI_NATIVE_DEFAULT_TEMPERATURE,
	type ReasoningEffort,
	type VerbosityLevel,
	type ReasoningEffortExtended,
	type ServiceTier,
	ApiProviderError,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions } from "../../shared/api"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { isMcpTool } from "../../utils/mcp-name"
import { sanitizeOpenAiCallId } from "../../utils/tool-id"

export type OpenAiNativeModel = ReturnType<OpenAiNativeHandler["getModel"]>

export class OpenAiNativeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "OpenAI Native"
	// Session ID for request tracking (persists for the lifetime of the handler)
	private readonly sessionId: string
	/**
	 * Some Responses streams emit tool-call argument deltas without stable call id/name.
	 * Track the last observed tool identity from output_item events so we can still
	 * emit `tool_call_partial` chunks (tool-call-only streams).
	 */
	private pendingToolCallId: string | undefined
	private pendingToolCallName: string | undefined
	// Resolved service tier from Responses API (actual tier used by OpenAI)
	private lastServiceTier: ServiceTier | undefined
	// Complete response output array (includes reasoning items with encrypted_content)
	private lastResponseOutput: any[] | undefined
	// Last top-level response id from Responses API (for troubleshooting)
	private lastResponseId: string | undefined
	// Abort controller for cancelling ongoing requests
	private abortController?: AbortController

	// Event types handled by the shared event processor to avoid duplication
	private readonly coreHandledEventTypes = new Set<string>([
		"response.text.delta",
		"response.output_text.delta",
		"response.reasoning.delta",
		"response.reasoning_text.delta",
		"response.reasoning_summary.delta",
		"response.reasoning_summary_text.delta",
		"response.refusal.delta",
		"response.output_item.added",
		"response.output_item.done",
		"response.done",
		"response.completed",
		"response.tool_call_arguments.delta",
		"response.function_call_arguments.delta",
		"response.tool_call_arguments.done",
		"response.function_call_arguments.done",
	])

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Generate a session ID for request tracking
		this.sessionId = uuidv7()
		// Default to including reasoning.summary: "auto" for models that support Responses API
		// reasoning summaries unless explicitly disabled.
		if (this.options.enableResponsesReasoningSummary === undefined) {
			this.options.enableResponsesReasoningSummary = true
		}
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		// Include originator, session_id, and User-Agent headers for API tracking and debugging
		const userAgent = `kilo-code/${Package.version} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`
		this.client = new OpenAI({
			baseURL: this.options.openAiNativeBaseUrl,
			apiKey,
			defaultHeaders: {
				originator: "kilo-code",
				session_id: this.sessionId,
				"User-Agent": userAgent,
			},
		})
	}

	private normalizeUsage(usage: any, model: OpenAiNativeModel): ApiStreamUsageChunk | undefined {
		if (!usage) return undefined

		// Prefer detailed shapes when available (Responses API)
		const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details

		// Extract cache information from details with better readability
		const hasCachedTokens = typeof inputDetails?.cached_tokens === "number"
		const hasCacheMissTokens = typeof inputDetails?.cache_miss_tokens === "number"
		const cachedFromDetails = hasCachedTokens ? inputDetails.cached_tokens : 0
		const missFromDetails = hasCacheMissTokens ? inputDetails.cache_miss_tokens : 0

		// If total input tokens are missing but we have details, derive from them
		let totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		if (totalInputTokens === 0 && inputDetails && (cachedFromDetails > 0 || missFromDetails > 0)) {
			totalInputTokens = cachedFromDetails + missFromDetails
		}

		const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0

		// Note: missFromDetails is NOT used as fallback for cache writes
		// Cache miss tokens represent tokens that weren't found in cache (part of input)
		// Cache write tokens represent tokens being written to cache for future use
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0

		const cacheReadTokens =
			usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? cachedFromDetails ?? 0

		// Resolve effective tier: prefer actual tier from response; otherwise requested tier
		const effectiveTier =
			this.lastServiceTier || (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
		const effectiveInfo = this.applyServiceTierPricing(model.info, effectiveTier)

		// Pass total input tokens directly to calculateApiCostOpenAI
		// The function handles subtracting both cache reads and writes internally
		const { totalCost } = calculateApiCostOpenAI(
			effectiveInfo,
			totalInputTokens,
			totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
		)

		const reasoningTokens =
			typeof usage.output_tokens_details?.reasoning_tokens === "number"
				? usage.output_tokens_details.reasoning_tokens
				: undefined

		const out: ApiStreamUsageChunk = {
			type: "usage",
			// Keep inputTokens as TOTAL input to preserve correct context length
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
			totalCost,
		}
		return out
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = this.getModel()

		// Use Responses API for ALL models
		yield* this.handleResponsesApiMessage(model, systemPrompt, messages, metadata)
	}

	private async *handleResponsesApiMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Reset resolved tier for this request; will be set from response if present
		this.lastServiceTier = undefined
		// Reset output array to capture current response output items
		this.lastResponseOutput = undefined
		// Reset last response id for this request
		this.lastResponseId = undefined
		// Reset pending tool identity for this request
		this.pendingToolCallId = undefined
		this.pendingToolCallName = undefined

		// Use Responses API for ALL models
		const { verbosity, reasoning } = this.getModel()

		// Resolve reasoning effort for models that support it
		const reasoningEffort = this.getReasoningEffort(model)

		// Format full conversation (messages already include reasoning items from API history)
		const formattedInput = this.formatFullConversation(systemPrompt, messages)

		// Build request body
		const requestBody = this.buildRequestBody(
			model,
			formattedInput,
			systemPrompt,
			verbosity,
			reasoningEffort,
			metadata,
		)

		// Make the request (pass systemPrompt and messages for potential retry)
		yield* this.executeRequest(requestBody, model, metadata, systemPrompt, messages)
	}

	private buildRequestBody(
		model: OpenAiNativeModel,
		formattedInput: any,
		systemPrompt: string,
		verbosity: any,
		reasoningEffort: ReasoningEffortExtended | undefined,
		metadata?: ApiHandlerCreateMessageMetadata,
	): any {
		// Ensure all properties are in the required array for OpenAI's strict mode
		// This recursively processes nested objects and array items
		const ensureAllRequired = (schema: any): any => {
			if (!schema || typeof schema !== "object" || schema.type !== "object") {
				return schema
			}

			const result = { ...schema }

			// OpenAI Responses API requires additionalProperties: false on all object schemas
			// Only add if not already set to false (to avoid unnecessary mutations)
			if (result.additionalProperties !== false) {
				result.additionalProperties = false
			}

			if (result.properties) {
				const allKeys = Object.keys(result.properties)
				result.required = allKeys

				// Recursively process nested objects
				const newProps = { ...result.properties }
				for (const key of allKeys) {
					const prop = newProps[key]
					if (prop.type === "object") {
						newProps[key] = ensureAllRequired(prop)
					} else if (prop.type === "array" && prop.items?.type === "object") {
						newProps[key] = {
							...prop,
							items: ensureAllRequired(prop.items),
						}
					}
				}
				result.properties = newProps
			}

			return result
		}

		// Adds additionalProperties: false to all object schemas recursively
		// without modifying required array. Used for MCP tools with strict: false
		// to comply with OpenAI Responses API requirements.
		const ensureAdditionalPropertiesFalse = (schema: any): any => {
			if (!schema || typeof schema !== "object" || schema.type !== "object") {
				return schema
			}

			const result = { ...schema }

			// OpenAI Responses API requires additionalProperties: false on all object schemas
			// Only add if not already set to false (to avoid unnecessary mutations)
			if (result.additionalProperties !== false) {
				result.additionalProperties = false
			}

			if (result.properties) {
				// Recursively process nested objects
				const newProps = { ...result.properties }
				for (const key of Object.keys(result.properties)) {
					const prop = newProps[key]
					if (prop && prop.type === "object") {
						newProps[key] = ensureAdditionalPropertiesFalse(prop)
					} else if (prop && prop.type === "array" && prop.items?.type === "object") {
						newProps[key] = {
							...prop,
							items: ensureAdditionalPropertiesFalse(prop.items),
						}
					}
				}
				result.properties = newProps
			}

			return result
		}

		// Build a request body for the OpenAI Responses API.
		// Ensure we explicitly pass max_output_tokens based on Roo's reserved model response calculation
		// so requests do not default to very large limits (e.g., 120k).
		interface ResponsesRequestBody {
			model: string
			input: Array<{ role: "user" | "assistant"; content: any[] } | { type: string; content: string }>
			stream: boolean
			reasoning?: { effort?: ReasoningEffortExtended; summary?: "auto" }
			text?: { verbosity: VerbosityLevel }
			temperature?: number
			max_output_tokens?: number
			store?: boolean
			instructions?: string
			service_tier?: ServiceTier
			include?: string[]
			/** Prompt cache retention policy: "in_memory" (default) or "24h" for extended caching */
			prompt_cache_retention?: "in_memory" | "24h"
			tools?: Array<{
				type: "function"
				name: string
				description?: string
				parameters?: any
				strict?: boolean
			}>
			tool_choice?: any
			parallel_tool_calls?: boolean
		}

		// Validate requested tier against model support; if not supported, omit.
		const requestedTier = (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
		const allowedTierNames = new Set(model.info.tiers?.map((t) => t.name).filter(Boolean) || [])

		// Decide whether to enable extended prompt cache retention for this request
		const promptCacheRetention = this.getPromptCacheRetention(model)

		const body: ResponsesRequestBody = {
			model: model.id,
			input: formattedInput,
			stream: true,
			// Always use stateless operation with encrypted reasoning
			store: false,
			// Always include instructions (system prompt) for Responses API.
			// Unlike Chat Completions, system/developer roles in input have no special semantics here.
			// The official way to set system behavior is the top-level `instructions` field.
			instructions: systemPrompt,
			// Only include encrypted reasoning content when reasoning effort is set
			...(reasoningEffort ? { include: ["reasoning.encrypted_content"] } : {}),
			...(reasoningEffort
				? {
						reasoning: {
							...(reasoningEffort ? { effort: reasoningEffort } : {}),
							...(this.options.enableResponsesReasoningSummary ? { summary: "auto" as const } : {}),
						},
					}
				: {}),
			// Only include temperature if the model supports it
			...(model.info.supportsTemperature !== false && {
				temperature: this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE,
			}),
			// Explicitly include the calculated max output tokens.
			// Use the per-request reserved output computed by Roo (params.maxTokens from getModelParams).
			...(model.maxTokens ? { max_output_tokens: model.maxTokens } : {}),
			// Include tier when selected and supported by the model, or when explicitly "default"
			...(requestedTier &&
				(requestedTier === "default" || allowedTierNames.has(requestedTier)) && {
					service_tier: requestedTier,
				}),
			// Enable extended prompt cache retention for models that support it.
			// This uses the OpenAI Responses API `prompt_cache_retention` parameter.
			...(promptCacheRetention ? { prompt_cache_retention: promptCacheRetention } : {}),
			...(metadata?.tools && {
				tools: metadata.tools
					.filter((tool) => tool.type === "function")
					.map((tool) => {
						// MCP tools use the 'mcp--' prefix - disable strict mode for them
						// to preserve optional parameters from the MCP server schema
						// But we still need to add additionalProperties: false for OpenAI Responses API
						const isMcp = isMcpTool(tool.function.name)
						return {
							type: "function",
							name: tool.function.name,
							description: tool.function.description,
							parameters: isMcp
								? ensureAdditionalPropertiesFalse(tool.function.parameters)
								: ensureAllRequired(tool.function.parameters),
							strict: !isMcp,
						}
					}),
			}),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
		}

		// For native tool protocol, control parallel tool calls based on the metadata flag.
		// When parallelToolCalls is true, allow parallel tool calls (OpenAI's parallel_tool_calls=true).
		// When false (default), explicitly disable parallel tool calls (false).
		// For XML or when protocol is unset, omit the field entirely so the API default applies.
		if (metadata?.toolProtocol === "native") {
			body.parallel_tool_calls = metadata.parallelToolCalls ?? false
		}

		// Include text.verbosity only when the model explicitly supports it
		if (model.info.supportsVerbosity === true) {
			body.text = { verbosity: (verbosity || "medium") as VerbosityLevel }
		}

		return body
	}

	private async *executeRequest(
		requestBody: any,
		model: OpenAiNativeModel,
		metadata?: ApiHandlerCreateMessageMetadata,
		systemPrompt?: string,
		messages?: Anthropic.Messages.MessageParam[],
	): ApiStream {
		// Create AbortController for cancellation
		this.abortController = new AbortController()

		// Build per-request headers using taskId when available, falling back to sessionId
		const taskId = metadata?.taskId
		const userAgent = `kilo-code/${Package.version} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`
		const requestHeaders: Record<string, string> = {
			originator: "kilo-code",
			session_id: taskId || this.sessionId,
			"User-Agent": userAgent,
		}

		try {
			// Use the official SDK with per-request headers
			const stream = (await (this.client as any).responses.create(requestBody, {
				signal: this.abortController.signal,
				headers: requestHeaders,
			})) as AsyncIterable<any>

			if (typeof (stream as any)[Symbol.asyncIterator] !== "function") {
				throw new Error(
					"OpenAI SDK did not return an AsyncIterable for Responses API streaming. Falling back to SSE.",
				)
			}

			for await (const event of stream) {
				// Check if request was aborted
				if (this.abortController.signal.aborted) {
					break
				}

				for await (const outChunk of this.processEvent(event, model)) {
					yield outChunk
				}
			}
		} catch (sdkErr: any) {
			// For errors, fallback to manual SSE via fetch
			yield* this.makeResponsesApiRequest(requestBody, model, metadata, systemPrompt, messages)
		} finally {
			this.abortController = undefined
		}
	}

	private formatFullConversation(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): any {
		// Format the entire conversation history for the Responses API using structured format
		// The Responses API (like Realtime API) accepts a list of items, which can be messages, function calls, or function call outputs.
		const formattedInput: any[] = []

		// Do NOT embed the system prompt as a developer message in the Responses API input.
		// The Responses API treats roles as free-form; use the top-level `instructions` field instead.

		// Process each message
		for (const message of messages) {
			// Check if this is a reasoning item (already formatted in API history)
			if ((message as any).type === "reasoning") {
				// Pass through reasoning items as-is
				formattedInput.push(message)
				continue
			}

			if (message.role === "user") {
				const content: any[] = []
				const toolResults: any[] = []

				if (typeof message.content === "string") {
					content.push({ type: "input_text", text: message.content })
				} else if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "text") {
							content.push({ type: "input_text", text: block.text })
						} else if (block.type === "image") {
							const image = block as Anthropic.Messages.ImageBlockParam
							// kilocode_change start
							let imageUrl: string
							if (image.source.type === "base64") {
								// Base64ImageSource has media_type and data
								imageUrl = `data:${image.source.media_type};base64,${image.source.data}`
							} else {
								// URLImageSource only has url
								imageUrl = image.source.url
							}
							// kilocode_change end
							content.push({ type: "input_image", image_url: imageUrl })
						} else if (block.type === "tool_result") {
							// Map Anthropic tool_result to Responses API function_call_output item
							const result =
								typeof block.content === "string"
									? block.content
									: block.content?.map((c) => (c.type === "text" ? c.text : "")).join("") || ""
							toolResults.push({
								type: "function_call_output",
								// Sanitize and truncate call_id to fit OpenAI's 64-char limit
								call_id: sanitizeOpenAiCallId(block.tool_use_id),
								output: result,
							})
						}
					}
				}

				// Add user message first
				if (content.length > 0) {
					formattedInput.push({ role: "user", content })
				}

				// Add tool results as separate items
				if (toolResults.length > 0) {
					formattedInput.push(...toolResults)
				}
			} else if (message.role === "assistant") {
				const content: any[] = []
				const toolCalls: any[] = []

				if (typeof message.content === "string") {
					content.push({ type: "output_text", text: message.content })
				} else if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "text") {
							content.push({ type: "output_text", text: block.text })
						} else if (block.type === "tool_use") {
							// Map Anthropic tool_use to Responses API function_call item
							toolCalls.push({
								type: "function_call",
								// Sanitize and truncate call_id to fit OpenAI's 64-char limit
								call_id: sanitizeOpenAiCallId(block.id),
								name: block.name,
								arguments: JSON.stringify(block.input),
							})
						}
					}
				}

				// Add assistant message if it has content
				if (content.length > 0) {
					formattedInput.push({ role: "assistant", content })
				}

				// Add tool calls as separate items
				if (toolCalls.length > 0) {
					formattedInput.push(...toolCalls)
				}
			}
		}

		return formattedInput
	}

	private async *makeResponsesApiRequest(
		requestBody: any,
		model: OpenAiNativeModel,
		metadata?: ApiHandlerCreateMessageMetadata,
		systemPrompt?: string,
		messages?: Anthropic.Messages.MessageParam[],
	): ApiStream {
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		const baseUrl = this.options.openAiNativeBaseUrl || "https://api.openai.com"
		const url = `${baseUrl}/v1/responses`

		// Create AbortController for cancellation
		this.abortController = new AbortController()

		// Build per-request headers using taskId when available, falling back to sessionId
		const taskId = metadata?.taskId
		const userAgent = `kilo-code/${Package.version} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					originator: "kilo-code",
					session_id: taskId || this.sessionId,
					"User-Agent": userAgent,
				},
				body: JSON.stringify(requestBody),
				signal: this.abortController.signal,
			})

			if (!response.ok) {
				const errorText = await response.text()

				let errorMessage = `OpenAI Responses API request failed (${response.status})`
				let errorDetails = ""

				// Try to parse error as JSON for better error messages
				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorDetails = errorJson.error.message
					} else if (errorJson.message) {
						errorDetails = errorJson.message
					} else {
						errorDetails = errorText
					}
				} catch {
					// If not JSON, use the raw text
					errorDetails = errorText
				}

				// Provide user-friendly error messages based on status code
				switch (response.status) {
					case 400:
						errorMessage = "Invalid request to Responses API. Please check your input parameters."
						break
					case 401:
						errorMessage = "Authentication failed. Please check your OpenAI API key."
						break
					case 403:
						errorMessage = "Access denied. Your API key may not have access to this endpoint."
						break
					case 404:
						errorMessage =
							"Responses API endpoint not found. The endpoint may not be available yet or requires a different configuration."
						break
					case 429:
						errorMessage = "Rate limit exceeded. Please try again later."
						break
					case 500:
					case 502:
					case 503:
						errorMessage = "OpenAI service error. Please try again later."
						break
					default:
						errorMessage = `Responses API error (${response.status})`
				}

				// Append details if available
				if (errorDetails) {
					errorMessage += ` - ${errorDetails}`
				}

				throw new Error(errorMessage)
			}

			if (!response.body) {
				throw new Error("Responses API error: No response body")
			}

			// Handle streaming response
			yield* this.handleStreamResponse(response.body, model)
		} catch (error) {
			const model = this.getModel()
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, model.id, "createMessage")
			TelemetryService.instance.captureException(apiError)

			if (error instanceof Error) {
				// Re-throw with the original error message if it's already formatted
				if (error.message.includes("Responses API")) {
					throw error
				}
				// Otherwise, wrap it with context
				throw new Error(`Failed to connect to Responses API: ${error.message}`)
			}
			// Handle non-Error objects
			throw new Error(`Unexpected error connecting to Responses API`)
		} finally {
			this.abortController = undefined
		}
	}

	/**
	 * Handles the streaming response from the Responses API.
	 *
	 * This function iterates through the Server-Sent Events (SSE) stream, parses each event,
	 * and yields structured data chunks (`ApiStream`). It handles a wide variety of event types,
	 * including text deltas, reasoning, usage data, and various status/tool events.
	 */
	private async *handleStreamResponse(body: ReadableStream<Uint8Array>, model: OpenAiNativeModel): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let hasContent = false
		let totalInputTokens = 0
		let totalOutputTokens = 0

		try {
			while (true) {
				// Check if request was aborted
				if (this.abortController?.signal.aborted) {
					break
				}

				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							continue
						}

						try {
							const parsed = JSON.parse(data)

							// Capture resolved service tier if present
							if (parsed.response?.service_tier) {
								this.lastServiceTier = parsed.response.service_tier as ServiceTier
							}
							// Capture complete output array (includes reasoning items with encrypted_content)
							if (parsed.response?.output && Array.isArray(parsed.response.output)) {
								this.lastResponseOutput = parsed.response.output
							}
							// Capture top-level response id
							if (parsed.response?.id) {
								this.lastResponseId = parsed.response.id as string
							}

							// Delegate standard event types to the shared processor to avoid duplication
							if (parsed?.type && this.coreHandledEventTypes.has(parsed.type)) {
								for await (const outChunk of this.processEvent(parsed, model)) {
									// Track whether we've emitted any content so fallback handling can decide appropriately
									// Include tool calls so tool-call-only responses aren't treated as empty
									if (
										outChunk.type === "text" ||
										outChunk.type === "reasoning" ||
										outChunk.type === "tool_call" ||
										outChunk.type === "tool_call_partial"
									) {
										hasContent = true
									}
									yield outChunk
								}
								continue
							}

							// Check if this is a complete response (non-streaming format)
							if (parsed.response && parsed.response.output && Array.isArray(parsed.response.output)) {
								// Handle complete response in the initial event
								for (const outputItem of parsed.response.output) {
									if (outputItem.type === "text" && outputItem.content) {
										for (const content of outputItem.content) {
											if (content.type === "text" && content.text) {
												hasContent = true
												yield {
													type: "text",
													text: content.text,
												}
											}
										}
									}
									// Additionally handle reasoning summaries if present (non-streaming summary output)
									if (outputItem.type === "reasoning" && Array.isArray(outputItem.summary)) {
										for (const summary of outputItem.summary) {
											if (summary?.type === "summary_text" && typeof summary.text === "string") {
												hasContent = true
												yield {
													type: "reasoning",
													text: summary.text,
												}
											}
										}
									}
								}
								// Check for usage in the complete response
								if (parsed.response.usage) {
									const usageData = this.normalizeUsage(parsed.response.usage, model)
									if (usageData) {
										yield usageData
									}
								}
							}
							// Handle streaming delta events for text content
							else if (
								parsed.type === "response.text.delta" ||
								parsed.type === "response.output_text.delta"
							) {
								// Primary streaming event for text deltas
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.text.done" ||
								parsed.type === "response.output_text.done"
							) {
								// Text streaming completed - final text already streamed via deltas
							}
							// Handle reasoning delta events
							else if (
								parsed.type === "response.reasoning.delta" ||
								parsed.type === "response.reasoning_text.delta"
							) {
								// Streaming reasoning content
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "reasoning",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.reasoning.done" ||
								parsed.type === "response.reasoning_text.done"
							) {
								// Reasoning streaming completed
							}
							// Handle reasoning summary events
							else if (
								parsed.type === "response.reasoning_summary.delta" ||
								parsed.type === "response.reasoning_summary_text.delta"
							) {
								// Streaming reasoning summary
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "reasoning",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.reasoning_summary.done" ||
								parsed.type === "response.reasoning_summary_text.done"
							) {
								// Reasoning summary completed
							}
							// Handle refusal delta events
							else if (parsed.type === "response.refusal.delta") {
								// Model is refusing to answer
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: `[Refusal] ${parsed.delta}`,
									}
								}
							} else if (parsed.type === "response.refusal.done") {
								// Refusal completed
							}
							// Handle audio delta events (for multimodal responses)
							else if (parsed.type === "response.audio.delta") {
								// Audio streaming - we'll skip for now as we focus on text
								// Could be handled in future for voice responses
							} else if (parsed.type === "response.audio.done") {
								// Audio completed
							}
							// Handle audio transcript delta events
							else if (parsed.type === "response.audio_transcript.delta") {
								// Audio transcript streaming
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.delta,
									}
								}
							} else if (parsed.type === "response.audio_transcript.done") {
								// Audio transcript completed
							}
							// Handle content part events (for structured content)
							else if (parsed.type === "response.content_part.added") {
								// New content part added - could be text, image, etc.
								if (parsed.part?.type === "text" && parsed.part.text) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.part.text,
									}
								}
							} else if (parsed.type === "response.content_part.done") {
								// Content part completed
							}
							// Handle output item events (alternative format)
							else if (parsed.type === "response.output_item.added") {
								// This is where the actual content comes through in some test cases
								if (parsed.item) {
									if (parsed.item.type === "text" && parsed.item.text) {
										hasContent = true
										yield { type: "text", text: parsed.item.text }
									} else if (parsed.item.type === "reasoning" && parsed.item.text) {
										hasContent = true
										yield { type: "reasoning", text: parsed.item.text }
									} else if (parsed.item.type === "message" && parsed.item.content) {
										// Handle message type items
										for (const content of parsed.item.content) {
											if (content.type === "text" && content.text) {
												hasContent = true
												yield { type: "text", text: content.text }
											}
										}
									}
								}
							} else if (parsed.type === "response.output_item.done") {
								// Output item completed
							}
							// Handle function/tool call events
							else if (
								parsed.type === "response.function_call_arguments.delta" ||
								parsed.type === "response.tool_call_arguments.delta" ||
								parsed.type === "response.function_call_arguments.done" ||
								parsed.type === "response.tool_call_arguments.done"
							) {
								// Delegated to processEvent (handles accumulation and completion)
								for await (const outChunk of this.processEvent(parsed, model)) {
									yield outChunk
								}
							}
							// Handle MCP (Model Context Protocol) tool events
							else if (parsed.type === "response.mcp_call_arguments.delta") {
								// MCP tool call arguments streaming
							} else if (parsed.type === "response.mcp_call_arguments.done") {
								// MCP tool call completed
							} else if (parsed.type === "response.mcp_call.in_progress") {
								// MCP tool call in progress
							} else if (
								parsed.type === "response.mcp_call.completed" ||
								parsed.type === "response.mcp_call.failed"
							) {
								// MCP tool call status events
							} else if (parsed.type === "response.mcp_list_tools.in_progress") {
								// MCP list tools in progress
							} else if (
								parsed.type === "response.mcp_list_tools.completed" ||
								parsed.type === "response.mcp_list_tools.failed"
							) {
								// MCP list tools status events
							}
							// Handle web search events
							else if (parsed.type === "response.web_search_call.searching") {
								// Web search in progress
							} else if (parsed.type === "response.web_search_call.in_progress") {
								// Processing web search results
							} else if (parsed.type === "response.web_search_call.completed") {
								// Web search completed
							}
							// Handle code interpreter events
							else if (parsed.type === "response.code_interpreter_call_code.delta") {
								// Code interpreter code streaming
								if (parsed.delta) {
									// Could yield as a special code type if needed
								}
							} else if (parsed.type === "response.code_interpreter_call_code.done") {
								// Code interpreter code completed
							} else if (parsed.type === "response.code_interpreter_call.interpreting") {
								// Code interpreter running
							} else if (parsed.type === "response.code_interpreter_call.in_progress") {
								// Code execution in progress
							} else if (parsed.type === "response.code_interpreter_call.completed") {
								// Code interpreter completed
							}
							// Handle file search events
							else if (parsed.type === "response.file_search_call.searching") {
								// File search in progress
							} else if (parsed.type === "response.file_search_call.in_progress") {
								// Processing file search results
							} else if (parsed.type === "response.file_search_call.completed") {
								// File search completed
							}
							// Handle image generation events
							else if (parsed.type === "response.image_gen_call.generating") {
								// Image generation in progress
							} else if (parsed.type === "response.image_gen_call.in_progress") {
								// Processing image generation
							} else if (parsed.type === "response.image_gen_call.partial_image") {
								// Image partially generated
							} else if (parsed.type === "response.image_gen_call.completed") {
								// Image generation completed
							}
							// Handle computer use events
							else if (
								parsed.type === "response.computer_tool_call.output_item" ||
								parsed.type === "response.computer_tool_call.output_screenshot"
							) {
								// Computer use tool events
							}
							// Handle annotation events
							else if (
								parsed.type === "response.output_text_annotation.added" ||
								parsed.type === "response.text_annotation.added"
							) {
								// Text annotation events - could be citations, references, etc.
							}
							// Handle error events
							else if (parsed.type === "response.error" || parsed.type === "error") {
								// Error event from the API
								if (parsed.error || parsed.message) {
									throw new Error(
										`Responses API error: ${parsed.error?.message || parsed.message || "Unknown error"}`,
									)
								}
							}
							// Handle incomplete event
							else if (parsed.type === "response.incomplete") {
								// Response was incomplete - might need to handle specially
							}
							// Handle queued event
							else if (parsed.type === "response.queued") {
								// Response is queued
							}
							// Handle in_progress event
							else if (parsed.type === "response.in_progress") {
								// Response is being processed
							}
							// Handle failed event
							else if (parsed.type === "response.failed") {
								// Response failed
								if (parsed.error || parsed.message) {
									throw new Error(
										`Response failed: ${parsed.error?.message || parsed.message || "Unknown failure"}`,
									)
								}
							} else if (parsed.type === "response.completed" || parsed.type === "response.done") {
								// Capture resolved service tier if present
								if (parsed.response?.service_tier) {
									this.lastServiceTier = parsed.response.service_tier as ServiceTier
								}
								// Capture top-level response id
								if (parsed.response?.id) {
									this.lastResponseId = parsed.response.id as string
								}
								// Capture complete output array (includes reasoning items with encrypted_content)
								if (parsed.response?.output && Array.isArray(parsed.response.output)) {
									this.lastResponseOutput = parsed.response.output
								}

								// Check if the done event contains the complete output (as a fallback)
								if (
									!hasContent &&
									parsed.response &&
									parsed.response.output &&
									Array.isArray(parsed.response.output)
								) {
									for (const outputItem of parsed.response.output) {
										if (outputItem.type === "message" && outputItem.content) {
											for (const content of outputItem.content) {
												if (content.type === "output_text" && content.text) {
													hasContent = true
													yield {
														type: "text",
														text: content.text,
													}
												}
											}
										}
										// Also surface reasoning summaries if present in the final output
										if (outputItem.type === "reasoning" && Array.isArray(outputItem.summary)) {
											for (const summary of outputItem.summary) {
												if (
													summary?.type === "summary_text" &&
													typeof summary.text === "string"
												) {
													hasContent = true
													yield {
														type: "reasoning",
														text: summary.text,
													}
												}
											}
										}
									}
								}

								// Usage for done/completed is already handled by processEvent in the SDK path.
								// For SSE path, usage often arrives separately; avoid double-emitting here.
							}
							// These are structural or status events, we can just log them at a lower level or ignore.
							else if (
								parsed.type === "response.created" ||
								parsed.type === "response.in_progress" ||
								parsed.type === "response.output_item.done" ||
								parsed.type === "response.content_part.added" ||
								parsed.type === "response.content_part.done"
							) {
								// Status events - no action needed
							}
							// Fallback for older formats or unexpected responses
							else if (parsed.choices?.[0]?.delta?.content) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.choices[0].delta.content,
								}
							}
							// Additional fallback: some events place text under 'item.text' even if type isn't matched above
							else if (
								parsed.item &&
								typeof parsed.item.text === "string" &&
								parsed.item.text.length > 0
							) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.item.text,
								}
							} else if (parsed.usage) {
								// Handle usage if it arrives in a separate, non-completed event
								const usageData = this.normalizeUsage(parsed.usage, model)
								if (usageData) {
									yield usageData
								}
							}
						} catch (e) {
							// Only ignore JSON parsing errors, re-throw actual API errors
							if (!(e instanceof SyntaxError)) {
								throw e
							}
						}
					}
					// Also try to parse non-SSE formatted lines
					else if (line.trim() && !line.startsWith(":")) {
						try {
							const parsed = JSON.parse(line)

							// Try to extract content from various possible locations
							if (parsed.content || parsed.text || parsed.message) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.content || parsed.text || parsed.message,
								}
							}
						} catch {
							// Not JSON, might be plain text - ignore
						}
					}
				}
			}

			// If we didn't get any content, don't throw - the API might have returned an empty response
			// This can happen in certain edge cases and shouldn't break the flow
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, model.id, "createMessage")
			TelemetryService.instance.captureException(apiError)

			if (error instanceof Error) {
				throw new Error(`Error processing response stream: ${error.message}`)
			}
			throw new Error("Unexpected error processing response stream")
		} finally {
			reader.releaseLock()
		}
	}

	/**
	 * Shared processor for Responses API events.
	 */
	private async *processEvent(event: any, model: OpenAiNativeModel): ApiStream {
		// Capture resolved service tier when available
		if (event?.response?.service_tier) {
			this.lastServiceTier = event.response.service_tier as ServiceTier
		}
		// Capture complete output array (includes reasoning items with encrypted_content)
		if (event?.response?.output && Array.isArray(event.response.output)) {
			this.lastResponseOutput = event.response.output
		}
		// Capture top-level response id
		if (event?.response?.id) {
			this.lastResponseId = event.response.id as string
		}

		// Handle known streaming text deltas
		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Handle reasoning deltas (including summary variants)
		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", text: event.delta }
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}` }
			}
			return
		}

		// Handle tool/function call deltas - emit as partial chunks
		if (
			event?.type === "response.tool_call_arguments.delta" ||
			event?.type === "response.function_call_arguments.delta"
		) {
			// Some streams omit stable identity on delta events; fall back to the
			// most recently observed tool identity from output_item events.
			const callId = event.call_id || event.tool_call_id || event.id || this.pendingToolCallId || undefined
			const name = event.name || event.function_name || this.pendingToolCallName || undefined
			const args = event.delta || event.arguments

			// Avoid emitting incomplete tool_call_partial chunks; the downstream
			// NativeToolCallParser needs a name to start a call.
			if (typeof name === "string" && name.length > 0 && typeof callId === "string" && callId.length > 0) {
				yield {
					type: "tool_call_partial",
					index: event.index ?? 0,
					id: callId,
					name,
					arguments: args,
				}
			}
			return
		}

		// Handle tool/function call completion events
		if (
			event?.type === "response.tool_call_arguments.done" ||
			event?.type === "response.function_call_arguments.done"
		) {
			// Tool call complete - no action needed, NativeToolCallParser handles completion
			return
		}

		// Handle output item additions/completions (SDK or Responses API alternative format)
		if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
			const item = event?.item
			if (item) {
				// Capture tool identity so subsequent argument deltas can be attributed.
				if (item.type === "function_call" || item.type === "tool_call") {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name || item.function?.name || item.function_name
					if (typeof callId === "string" && callId.length > 0) {
						this.pendingToolCallId = callId
						this.pendingToolCallName = typeof name === "string" ? name : undefined
					}
				}

				if (item.type === "text" && item.text) {
					yield { type: "text", text: item.text }
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", text: item.text }
				} else if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						// Some implementations send 'text'; others send 'output_text'
						if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
							yield { type: "text", text: content.text }
						}
					}
				} else if (
					(item.type === "function_call" || item.type === "tool_call") &&
					event.type === "response.output_item.done" // Only handle done events for tool calls to ensure arguments are complete
				) {
					// Handle complete tool/function call item
					// Emit as tool_call for backward compatibility with non-streaming tool handling
					const callId = item.call_id || item.tool_call_id || item.id
					if (callId) {
						const args = item.arguments || item.function?.arguments || item.function_arguments
						yield {
							type: "tool_call",
							id: callId,
							name: item.name || item.function?.name || item.function_name || "",
							arguments: typeof args === "string" ? args : "{}",
						}
					}
				}
			}
			return
		}

		// Completion events that may carry usage
		if (event?.type === "response.done" || event?.type === "response.completed") {
			const usage = event?.response?.usage || event?.usage || undefined
			const usageData = this.normalizeUsage(usage, model)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for older formats or unexpected objects
		if (event?.choices?.[0]?.delta?.content) {
			yield { type: "text", text: event.choices[0].delta.content }
			return
		}

		if (event?.usage) {
			const usageData = this.normalizeUsage(event.usage, model)
			if (usageData) {
				yield usageData
			}
		}
	}

	private getReasoningEffort(model: OpenAiNativeModel): ReasoningEffortExtended | undefined {
		// Single source of truth: user setting overrides, else model default (from types).
		const selected = (this.options.reasoningEffort as any) ?? (model.info.reasoningEffort as any)
		return selected && selected !== "disable" ? (selected as any) : undefined
	}

	/**
	 * Returns the appropriate prompt cache retention policy for the given model, if any.
	 *
	 * The policy is driven by ModelInfo.promptCacheRetention so that model-specific details
	 * live in the shared types layer rather than this provider. When set to "24h" and the
	 * model supports prompt caching, extended prompt cache retention is requested.
	 */
	private getPromptCacheRetention(model: OpenAiNativeModel): "24h" | undefined {
		if (!model.info.supportsPromptCache) return undefined

		if (model.info.promptCacheRetention === "24h") {
			return "24h"
		}

		return undefined
	}

	/**
	 * Returns a shallow-cloned ModelInfo with pricing overridden for the given tier, if available.
	 * If no tier or no overrides exist, the original ModelInfo is returned.
	 */
	private applyServiceTierPricing(info: ModelInfo, tier?: ServiceTier): ModelInfo {
		if (!tier || tier === "default") return info

		// Find the tier with matching name in the tiers array
		const tierInfo = info.tiers?.find((t) => t.name === tier)
		if (!tierInfo) return info

		return {
			...info,
			inputPrice: tierInfo.inputPrice ?? info.inputPrice,
			outputPrice: tierInfo.outputPrice ?? info.outputPrice,
			cacheReadsPrice: tierInfo.cacheReadsPrice ?? info.cacheReadsPrice,
			cacheWritesPrice: tierInfo.cacheWritesPrice ?? info.cacheWritesPrice,
		}
	}

	// Removed isResponsesApiModel method as ALL models now use the Responses API

	override getModel() {
		const modelId = this.options.apiModelId

		let id =
			modelId && modelId in openAiNativeModels ? (modelId as OpenAiNativeModelId) : openAiNativeDefaultModelId

		const info: ModelInfo = openAiNativeModels[id]

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: OPENAI_NATIVE_DEFAULT_TEMPERATURE,
		})

		// Reasoning effort inclusion is handled by getModelParams/getOpenAiReasoning.
		// Do not re-compute or filter efforts here.

		// The o3 models are named like "o3-mini-[reasoning-effort]", which are
		// not valid model ids, so we need to strip the suffix.
		return { id: id.startsWith("o3-mini") ? "o3-mini" : id, info, ...params, verbosity: params.verbosity }
	}

	/**
	 * Extracts encrypted_content and id from the first reasoning item in the output array.
	 * This is the minimal data needed for stateless API continuity.
	 *
	 * @returns Object with encrypted_content and id, or undefined if not available
	 */
	getEncryptedContent(): { encrypted_content: string; id?: string } | undefined {
		if (!this.lastResponseOutput) return undefined

		// Find the first reasoning item with encrypted_content
		const reasoningItem = this.lastResponseOutput.find(
			(item) => item.type === "reasoning" && item.encrypted_content,
		)

		if (!reasoningItem?.encrypted_content) return undefined

		return {
			encrypted_content: reasoningItem.encrypted_content,
			...(reasoningItem.id ? { id: reasoningItem.id } : {}),
		}
	}

	getResponseId(): string | undefined {
		return this.lastResponseId
	}

	async completePrompt(prompt: string): Promise<string> {
		// Create AbortController for cancellation
		this.abortController = new AbortController()

		try {
			const model = this.getModel()
			const { verbosity, reasoning } = model

			// Resolve reasoning effort for models that support it
			const reasoningEffort = this.getReasoningEffort(model)

			// Build request body for Responses API
			const requestBody: any = {
				model: model.id,
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: prompt }],
					},
				],
				stream: false, // Non-streaming for completePrompt
				store: false, // Don't store prompt completions
				// Only include encrypted reasoning content when reasoning effort is set
				...(reasoningEffort ? { include: ["reasoning.encrypted_content"] } : {}),
			}

			// Include service tier if selected and supported
			const requestedTier = (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
			const allowedTierNames = new Set(model.info.tiers?.map((t) => t.name).filter(Boolean) || [])
			if (requestedTier && (requestedTier === "default" || allowedTierNames.has(requestedTier))) {
				requestBody.service_tier = requestedTier
			}

			// Add reasoning if supported
			if (reasoningEffort) {
				requestBody.reasoning = {
					effort: reasoningEffort,
					...(this.options.enableResponsesReasoningSummary ? { summary: "auto" as const } : {}),
				}
			}

			// Only include temperature if the model supports it
			if (model.info.supportsTemperature !== false) {
				requestBody.temperature = this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE
			}

			// Include max_output_tokens if available
			if (model.maxTokens) {
				requestBody.max_output_tokens = model.maxTokens
			}

			// Include text.verbosity only when the model explicitly supports it
			if (model.info.supportsVerbosity === true) {
				requestBody.text = { verbosity: (verbosity || "medium") as VerbosityLevel }
			}

			// Enable extended prompt cache retention for eligible models
			const promptCacheRetention = this.getPromptCacheRetention(model)
			if (promptCacheRetention) {
				requestBody.prompt_cache_retention = promptCacheRetention
			}

			// Make the non-streaming request
			const response = await (this.client as any).responses.create(requestBody, {
				signal: this.abortController.signal,
			})

			// Extract text from the response
			if (response?.output && Array.isArray(response.output)) {
				for (const outputItem of response.output) {
					if (outputItem.type === "message" && outputItem.content) {
						for (const content of outputItem.content) {
							if (content.type === "output_text" && content.text) {
								return content.text
							}
						}
					}
				}
			}

			// Fallback: check for direct text in response
			if (response?.text) {
				return response.text
			}

			return ""
		} catch (error) {
			const errorModel = this.getModel()
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, errorModel.id, "completePrompt")
			TelemetryService.instance.captureException(apiError)

			if (error instanceof Error) {
				throw new Error(`OpenAI Native completion error: ${error.message}`)
			}
			throw error
		} finally {
			this.abortController = undefined
		}
	}
}
