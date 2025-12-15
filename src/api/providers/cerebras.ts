import { Anthropic } from "@anthropic-ai/sdk"

import { type CerebrasModelId, cerebrasDefaultModelId, cerebrasModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../shared/cost"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { XmlMatcher } from "../../utils/xml-matcher"

import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { BaseProvider } from "./base-provider"
import { DEFAULT_HEADERS } from "./constants"
import { t } from "../../i18n"

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
const CEREBRAS_DEFAULT_TEMPERATURE = 0

export class CerebrasHandler extends BaseProvider implements SingleCompletionHandler {
	private apiKey: string
	private providerModels: typeof cerebrasModels
	private defaultProviderModelId: CerebrasModelId
	private options: ApiHandlerOptions
	private lastUsage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 }

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.apiKey = options.cerebrasApiKey || ""
		this.providerModels = cerebrasModels
		this.defaultProviderModelId = cerebrasDefaultModelId

		if (!this.apiKey) {
			throw new Error("Cerebras API key is required")
		}
	}

	getModel(): { id: CerebrasModelId; info: (typeof cerebrasModels)[CerebrasModelId] } {
		const modelId = this.options.apiModelId as CerebrasModelId
		const validModelId = modelId && this.providerModels[modelId] ? modelId : this.defaultProviderModelId

		return {
			id: validModelId,
			info: this.providerModels[validModelId],
		}
	}

	/**
	 * Override convertToolSchemaForOpenAI to remove unsupported schema fields for Cerebras.
	 * Cerebras doesn't support minItems/maxItems in array schemas with strict mode.
	 */
	protected override convertToolSchemaForOpenAI(schema: any): any {
		const converted = super.convertToolSchemaForOpenAI(schema)
		return this.stripUnsupportedSchemaFields(converted)
	}

	/**
	 * Recursively strips unsupported schema fields for Cerebras.
	 * Cerebras strict mode doesn't support minItems, maxItems on arrays.
	 */
	private stripUnsupportedSchemaFields(schema: any): any {
		if (!schema || typeof schema !== "object") {
			return schema
		}

		const result = { ...schema }

		// Remove unsupported array constraints
		if (result.type === "array" || (Array.isArray(result.type) && result.type.includes("array"))) {
			delete result.minItems
			delete result.maxItems
		}

		// Recursively process properties
		if (result.properties) {
			const newProps = { ...result.properties }
			for (const key of Object.keys(newProps)) {
				newProps[key] = this.stripUnsupportedSchemaFields(newProps[key])
			}
			result.properties = newProps
		}

		// Recursively process array items
		if (result.items) {
			result.items = this.stripUnsupportedSchemaFields(result.items)
		}

		return result
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: model, info: modelInfo } = this.getModel()
		const max_tokens = modelInfo.maxTokens
		const supportsNativeTools = modelInfo.supportsNativeTools ?? false
		const temperature = this.options.modelTemperature ?? CEREBRAS_DEFAULT_TEMPERATURE

		// Check if we should use native tool calling
		const useNativeTools =
			supportsNativeTools && metadata?.tools && metadata.tools.length > 0 && metadata?.toolProtocol !== "xml"

		// Convert Anthropic messages to OpenAI format (Cerebras is OpenAI-compatible)
		const openaiMessages = convertToOpenAiMessages(messages)

		// Prepare request body following Cerebras API specification exactly
		const requestBody: Record<string, any> = {
			model,
			messages: [{ role: "system", content: systemPrompt }, ...openaiMessages],
			stream: true,
			// Use max_completion_tokens (Cerebras-specific parameter)
			...(max_tokens && max_tokens > 0 && max_tokens <= 32768 ? { max_completion_tokens: max_tokens } : {}),
			// Clamp temperature to Cerebras range (0 to 1.5)
			...(temperature !== undefined && temperature !== CEREBRAS_DEFAULT_TEMPERATURE
				? {
						temperature: Math.max(0, Math.min(1.5, temperature)),
					}
				: {}),
			// Native tool calling support
			...(useNativeTools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(useNativeTools && metadata.tool_choice && { tool_choice: metadata.tool_choice }),
			...(useNativeTools && { parallel_tool_calls: metadata?.parallelToolCalls ?? false }),
		}

		try {
			const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
				method: "POST",
				headers: {
					...DEFAULT_HEADERS,
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					"X-Cerebras-3rd-Party-Integration": "kilocode",
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorText = await response.text()

				let errorMessage = "Unknown error"
				try {
					const errorJson = JSON.parse(errorText)
					errorMessage = errorJson.error?.message || errorJson.message || JSON.stringify(errorJson, null, 2)
				} catch {
					errorMessage = errorText || `HTTP ${response.status}`
				}

				// Provide more actionable error messages
				if (response.status === 401) {
					throw new Error(t("common:errors.cerebras.authenticationFailed"))
				} else if (response.status === 403) {
					throw new Error(t("common:errors.cerebras.accessForbidden"))
				} else if (response.status === 429) {
					throw new Error(t("common:errors.cerebras.rateLimitExceeded"))
				} else if (response.status >= 500) {
					throw new Error(t("common:errors.cerebras.serverError", { status: response.status }))
				} else {
					throw new Error(
						t("common:errors.cerebras.genericError", { status: response.status, message: errorMessage }),
					)
				}
			}

			if (!response.body) {
				throw new Error(t("common:errors.cerebras.noResponseBody"))
			}

			// Initialize XmlMatcher to parse <think>...</think> tags
			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ""
			let inputTokens = 0
			let outputTokens = 0

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop() || "" // Keep the last incomplete line in the buffer

					for (const line of lines) {
						if (line.trim() === "") continue

						try {
							if (line.startsWith("data: ")) {
								const jsonStr = line.slice(6).trim()
								if (jsonStr === "[DONE]") {
									continue
								}

								const parsed = JSON.parse(jsonStr)

								const delta = parsed.choices?.[0]?.delta

								// Handle text content - parse for thinking tokens
								if (delta?.content) {
									const content = delta.content

									// Use XmlMatcher to parse <think>...</think> tags
									for (const chunk of matcher.update(content)) {
										yield chunk
									}
								}

								// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
								if (delta?.tool_calls) {
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

								// Handle usage information if available
								if (parsed.usage) {
									inputTokens = parsed.usage.prompt_tokens || 0
									outputTokens = parsed.usage.completion_tokens || 0
								}
							}
						} catch (error) {
							// Silently ignore malformed streaming data lines
						}
					}
				}
			} finally {
				reader.releaseLock()
			}

			// Process any remaining content in the matcher
			for (const chunk of matcher.final()) {
				yield chunk
			}

			// Provide token usage estimate if not available from API
			if (inputTokens === 0 || outputTokens === 0) {
				const inputText =
					systemPrompt +
					openaiMessages
						.map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
						.join("")
				inputTokens = inputTokens || Math.ceil(inputText.length / 4) // Rough estimate: 4 chars per token
				outputTokens = outputTokens || Math.ceil((max_tokens || 1000) / 10) // Rough estimate
			}

			// Store usage for cost calculation
			this.lastUsage = { inputTokens, outputTokens }

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.cerebras.completionError", { error: error.message }))
			}
			throw error
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: model } = this.getModel()

		// Prepare request body for non-streaming completion
		const requestBody = {
			model,
			messages: [{ role: "user", content: prompt }],
			stream: false,
		}

		try {
			const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
				method: "POST",
				headers: {
					...DEFAULT_HEADERS,
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					"X-Cerebras-3rd-Party-Integration": "kilocode",
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorText = await response.text()

				// Provide consistent error handling with createMessage
				if (response.status === 401) {
					throw new Error(t("common:errors.cerebras.authenticationFailed"))
				} else if (response.status === 403) {
					throw new Error(t("common:errors.cerebras.accessForbidden"))
				} else if (response.status === 429) {
					throw new Error(t("common:errors.cerebras.rateLimitExceeded"))
				} else if (response.status >= 500) {
					throw new Error(t("common:errors.cerebras.serverError", { status: response.status }))
				} else {
					throw new Error(
						t("common:errors.cerebras.genericError", { status: response.status, message: errorText }),
					)
				}
			}

			const result = await response.json()
			return result.choices?.[0]?.message?.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.cerebras.completionError", { error: error.message }))
			}
			throw error
		}
	}

	getApiCost(metadata: ApiHandlerCreateMessageMetadata): number {
		const { info } = this.getModel()
		// Use actual token usage from the last request
		const { inputTokens, outputTokens } = this.lastUsage
		const { totalCost } = calculateApiCostOpenAI(info, inputTokens, outputTokens)
		return totalCost
	}
}
