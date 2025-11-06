import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	getActiveToolUseStyle,
} from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { convertToOpenAiMessages } from "../transform/openai-format"
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
import type {
	ApiHandlerCreateMessageMetadata, // kilocode_change
	SingleCompletionHandler,
} from "../index"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"
import { addNativeToolCallsToParams, processNativeToolCallsFromDelta } from "./kilocode/nativeToolCallHelpers"

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

import { handleOpenAIError } from "./utils/openai-error-handler"

function stripThinkingTokens(text: string): string {
	// Remove <think>...</think> blocks entirely, including nested ones
	return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

function flattenMessageContent(content: any): string {
	if (typeof content === "string") {
		return content
	}

	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") {
					return part
				}
				if (part.type === "text") {
					return part.text || ""
				}
				if (part.type === "image_url") {
					return "[Image]" // Placeholder for images since Cerebras doesn't support images
				}
				return ""
			})
			.filter(Boolean)
			.join("\n")
	}

	// Fallback for any other content types
	return String(content || "")
}

// Image generation types
interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
	provider?: OpenRouterProviderParams // kilocode_change
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

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openRouterBaseUrl || "https://api.matterai.so/v1/web"
		const apiKey = this.options.openRouterApiKey ?? "not-provided"

		console.log("baseURL", baseURL)
		console.log("apiKey", apiKey)

		// this.client = new OpenAI({ baseURL: "http://localhost:4064/v1/web", apiKey, defaultHeaders: DEFAULT_HEADERS })
		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: DEFAULT_HEADERS })
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

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata, // kilocode_change
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}
		let { id: modelId, maxTokens, temperature, topP, reasoning } = model
		const convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

		// openAiMessages = openAiMessages
		// 	.map((msg: any) => {
		// 		let content = flattenMessageContent(msg.content)

		// 		// Strip thinking tokens from assistant messages to prevent confusion
		// 		if (msg.role === "assistant") {
		// 			content = stripThinkingTokens(content)
		// 		}

		// 		return {
		// 			role: msg.role,
		// 			content,
		// 		}
		// 	})
		// 	.filter((msg: any) => msg.content.trim() !== "")

		const transforms = (this.options.openRouterUseMiddleOutTransform ?? true) ? ["middle-out"] : undefined

		// console.log("convertedMessages", convertedMessages)

		// https://openrouter.ai/docs/transforms
		// const completionParams: OpenRouterChatCompletionParams = {
		// 	model: modelId,
		// 	...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
		// 	temperature,
		// 	top_p: topP,
		// 	messages: convertedMessages,
		// 	stream: true,
		// 	stream_options: { include_usage: true },
		// 	...this.getProviderParams(), // kilocode_change: original expression was moved into function
		// 	...(transforms && { transforms }),
		// 	...(reasoning && { reasoning }),
		// }

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: model.id,
			temperature: 0,
			top_p: topP,
			messages: convertedMessages,
			stream: true,
			stream_options: { include_usage: true },
			max_completion_tokens: model.info.maxTokens,
		}

		addNativeToolCallsToParams(requestOptions, this.options, metadata)

		let stream
		try {
			// console.log("requestOptions", requestOptions)
			// console.log("customRequestOptions", this.customRequestOptions(metadata))
			stream = await this.client.chat.completions.create(
				requestOptions,
				this.customRequestOptions(metadata), // kilocode_change
			)
		} catch (error) {
			// kilocode_change start
			if (this.providerName == "KiloCode" && isAnyRecognizedKiloCodeError(error)) {
				throw error
			}
			throw new Error(makeOpenRouterErrorReadable(error))
			// kilocode_change end
		}

		let lastUsage: CompletionUsage | undefined = undefined
		let inferenceProvider: string | undefined // kilocode_change

		try {
			let fullContent = ""

			let isThinking = false

			for await (const chunk of stream) {
				// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
				if ("error" in chunk) {
					const error = chunk.error as { message?: string; code?: number }
					console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
					throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
				}

				// kilocode_change start
				if ("provider" in chunk && typeof chunk.provider === "string") {
					inferenceProvider = chunk.provider
				}
				// kilocode_change end

				// Handle usage data which can be present even when choices is empty
				if (chunk.usage) {
					lastUsage = chunk.usage
				}

				// Get delta from choices, but handle case where choices might be empty
				const delta = chunk.choices[0]?.delta

				// Add defensive check for delta being undefined (e.g., final chunk with only usage data)
				if (!delta) {
					// Skip delta processing but continue to allow usage processing at the end of the loop
					continue
				}

				verifyFinishReason(chunk.choices[0]) // kilocode_change

				// if (
				// 	delta /* kilocode_change */ &&
				// 	"reasoning" in delta &&
				// 	delta.reasoning &&
				// 	typeof delta.reasoning === "string"
				// ) {
				// 	yield { type: "reasoning", text: delta.reasoning }
				// }

				if (delta.content) {
					let newText = delta.content
					if (fullContent && newText.startsWith(fullContent)) {
						newText = newText.substring(fullContent.length)
					}
					fullContent = delta.content

					// pending items
					// 1. Thinking block bug
					// 2. Pricing
					// 3. Use Cursor prompt + tool calling

					console.log("newText", newText)
					console.log("isThinking", isThinking)

					if (newText) {
						if (newText.includes("<think>")) {
							isThinking = true
						}
						// Check for thinking blocks
						if (newText.includes("<think>") || newText.includes("</think>") || isThinking) {
							if (newText.includes("</think>")) {
								isThinking = false
							}

							newText = newText.replace(/<\/?think>/g, "")
							newText = newText.replace(/<think>/g, "")
							newText = newText.trim()

							yield {
								type: "reasoning",
								text: newText,
							}
						} else {
							yield {
								type: "text",
								text: newText,
							}
						}
					}
				}

				if ("reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						text: (delta.reasoning_content as string | undefined) || "",
					}
				}

				// Handle native tool calls when toolStyle is "json"
				yield* processNativeToolCallsFromDelta(delta, getActiveToolUseStyle(this.options))
				// kilocode_change end

				// if (delta?.content) {
				// 	yield { type: "text", text: delta.content }
				// }
			}
		} catch (error) {
			console.error("OpenRouter API Error:", error)
			let errorMessage = makeOpenRouterErrorReadable(error)
			throw new Error(errorMessage)
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
		let { id: modelId, maxTokens, temperature, reasoning } = await this.fetchModel()

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			...this.getProviderParams(), // kilocode_change: original expression was moved into function
			...(reasoning && { reasoning }),
		}

		let response
		try {
			response = await this.client.chat.completions.create(
				completionParams,
				this.customRequestOptions(), // kilocode_change
			)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		if ("error" in response) {
			const error = response.error as { message?: string; code?: number }
			throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return completion.choices[0]?.message?.content || ""
	}

	/**
	 * Generate an image using OpenRouter's image generation API
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

		try {
			const response = await fetch(
				`${this.options.openRouterBaseUrl || "https://api.matterai.so/v1/web"}chat/completions`, // kilocode_change: support baseUrl
				{
					method: "POST",
					headers: {
						// kilocode_change start
						...DEFAULT_HEADERS,
						...this.getCustomRequestHeaders(taskId),
						// kilocode_change end
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model,
						messages: [
							{
								role: "user",
								content: inputImage
									? [
											{
												type: "text",
												text: prompt,
											},
											{
												type: "image_url",
												image_url: {
													url: inputImage,
												},
											},
										]
									: prompt,
							},
						],
						modalities: ["image", "text"],
					}),
				},
			)

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `Failed to generate image: ${response.status} ${response.statusText}`
				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage = `Failed to generate image: ${errorJson.error.message}`
					}
				} catch {
					// Use default error message
				}
				return {
					success: false,
					error: errorMessage,
				}
			}

			const result: ImageGenerationResponse = await response.json()

			if (result.error) {
				return {
					success: false,
					error: `Failed to generate image: ${result.error.message}`,
				}
			}

			// Extract the generated image from the response
			const images = result.choices?.[0]?.message?.images
			if (!images || images.length === 0) {
				return {
					success: false,
					error: "No image was generated in the response",
				}
			}

			const imageData = images[0]?.image_url?.url
			if (!imageData) {
				return {
					success: false,
					error: "Invalid image data in response",
				}
			}

			// Extract base64 data from data URL
			const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
			if (!base64Match) {
				return {
					success: false,
					error: "Invalid image format received",
				}
			}

			return {
				success: true,
				imageData: imageData,
				imageFormat: base64Match[1],
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error occurred",
			}
		}
	}
}

// kilocode_change start
function makeOpenRouterErrorReadable(error: any) {
	try {
		// Add logging to help debug the issue
		console.debug("makeOpenRouterErrorReadable called with error:", JSON.stringify(error, null, 2))

		const metadata = error?.error?.metadata as { raw?: string; provider_name?: string } | undefined
		const parsedJson = safeJsonParse(metadata?.raw)
		const rawError = parsedJson as { error?: string & { message?: string }; detail?: string } | undefined

		if (error?.code !== 429 && error?.code !== 418) {
			// Safely extract error message, handling cases where rawError?.error might be an object
			let errorMessage: string | undefined

			if (rawError?.error?.message) {
				errorMessage = rawError.error.message
			} else if (typeof rawError?.error === "string") {
				errorMessage = rawError.error
			} else if (rawError?.detail) {
				errorMessage = rawError.detail
			} else if (error?.message) {
				errorMessage = error.message
			} else {
				// Handle case where error.error might be an object with undefined properties
				try {
					// If rawError?.error is an object, we need to safely stringify it
					if (rawError?.error && typeof rawError.error === "object") {
						errorMessage =
							JSON.stringify(rawError.error, (key, value) => {
								// Replace undefined values with a placeholder to avoid serialization issues
								return value === undefined ? "[undefined]" : value
							}) || "unknown error"
					} else {
						errorMessage = JSON.stringify(rawError?.error) || "unknown error"
					}
				} catch (e) {
					console.debug("Error stringifying rawError?.error:", e)
					errorMessage = "unknown error"
				}
			}

			// Ensure errorMessage is a string and doesn't contain problematic content
			if (typeof errorMessage !== "string") {
				try {
					errorMessage = JSON.stringify(errorMessage) || "unknown error"
				} catch (e) {
					errorMessage = "unknown error"
				}
			}

			const providerName = metadata?.provider_name ?? "Provider"

			// Ensure providerName is a string
			const safeProviderName = typeof providerName === "string" ? providerName : "Provider"

			return `${safeProviderName} error: ${errorMessage}`
		}

		try {
			const parsedJson = JSON.parse(error.error.metadata?.raw)
			const retryAfter = parsedJson?.error?.details
				?.map((detail: any) => detail.retryDelay)
				.filter((r: any) => r)[0]
			if (retryAfter) {
				return `Rate limit exceeded, try again in ${retryAfter}.`
			}
		} catch (e) {
			console.debug("Error parsing rate limit info:", e)
		}

		const fallbackMessage = error?.message || error
		return `Rate limit exceeded, try again later.\n${typeof fallbackMessage === "string" ? fallbackMessage : "Unknown error"}`
	} catch (e) {
		// If anything goes wrong in our error handling, return a safe default
		console.error("Error in makeOpenRouterErrorReadable:", e)
		return "Provider error: An unexpected error occurred while processing the API response"
	}
}
// kilocode_change end
