import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import OpenAI from "openai"

import {
	type MistralModelId,
	mistralDefaultModelId,
	mistralModels,
	MISTRAL_DEFAULT_TEMPERATURE,
	ApiProviderError,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandlerOptions } from "../../shared/api"

import { convertToMistralMessages } from "../transform/mistral-format"
import { ApiStream } from "../transform/stream"
import { handleProviderError } from "./utils/error-handler"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { DEFAULT_HEADERS } from "./constants" // kilocode_change
import { streamSse } from "../../services/continuedev/core/fetch/stream" // kilocode_change
import type { CompletionUsage } from "./openrouter" // kilocode_change
import type { FimHandler } from "./kilocode/FimHandler" // kilocode_change

// Type helper to handle thinking chunks from Mistral API
// The SDK includes ThinkChunk but TypeScript has trouble with the discriminated union
type ContentChunkWithThinking = {
	type: string
	text?: string
	thinking?: Array<{ type: string; text?: string }>
}

// Type for Mistral tool calls in stream delta
type MistralToolCall = {
	id?: string
	type?: string
	function?: {
		name?: string
		arguments?: string
	}
}

// Type for Mistral tool definition - matches Mistral SDK Tool type
type MistralTool = {
	type: "function"
	function: {
		name: string
		description?: string
		parameters: Record<string, unknown>
	}
}

export class MistralHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: Mistral
	private readonly providerName = "Mistral"

	constructor(options: ApiHandlerOptions) {
		super()

		if (!options.mistralApiKey) {
			throw new Error("Mistral API key is required")
		}

		// Set default model ID if not provided.
		const apiModelId = options.apiModelId || mistralDefaultModelId
		this.options = { ...options, apiModelId }

		this.client = new Mistral({
			serverURL: apiModelId.startsWith("codestral-")
				? this.options.mistralCodestralUrl || "https://codestral.mistral.ai"
				: "https://api.mistral.ai",
			apiKey: this.options.mistralApiKey,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: model, info, maxTokens, temperature } = this.getModel()

		// Build request options
		const requestOptions: {
			model: string
			messages: ReturnType<typeof convertToMistralMessages>
			maxTokens: number
			temperature: number
			tools?: MistralTool[]
			toolChoice?: "auto" | "none" | "any" | "required" | { type: "function"; function: { name: string } }
		} = {
			model,
			messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
			maxTokens: maxTokens ?? info.maxTokens,
			temperature,
		}

		// Add tools if provided and toolProtocol is not 'xml' and model supports native tools
		const supportsNativeTools = info.supportsNativeTools ?? false
		if (metadata?.tools && metadata.tools.length > 0 && metadata?.toolProtocol !== "xml" && supportsNativeTools) {
			requestOptions.tools = this.convertToolsForMistral(metadata.tools)
			// Always use "any" to require tool use
			requestOptions.toolChoice = "any"
		}

		// Temporary debug log for QA
		// console.log("[MISTRAL DEBUG] Raw API request body:", requestOptions)

		let response
		try {
			response = await this.client.chat.stream(requestOptions)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, model, "createMessage")
			TelemetryService.instance.captureException(apiError)
			throw new Error(`Mistral completion error: ${errorMessage}`)
		}

		for await (const event of response) {
			const delta = event.data.choices[0]?.delta

			if (delta?.content) {
				if (typeof delta.content === "string") {
					// Handle string content as text
					yield { type: "text", text: delta.content }
				} else if (Array.isArray(delta.content)) {
					// Handle array of content chunks
					// The SDK v1.9.18 supports ThinkChunk with type "thinking"
					for (const chunk of delta.content as ContentChunkWithThinking[]) {
						if (chunk.type === "thinking" && chunk.thinking) {
							// Handle thinking content as reasoning chunks
							// ThinkChunk has a 'thinking' property that contains an array of text/reference chunks
							for (const thinkingPart of chunk.thinking) {
								if (thinkingPart.type === "text" && thinkingPart.text) {
									yield { type: "reasoning", text: thinkingPart.text }
								}
							}
						} else if (chunk.type === "text" && chunk.text) {
							// Handle text content normally
							yield { type: "text", text: chunk.text }
						}
					}
				}
			}

			// Handle tool calls in stream
			// Mistral SDK provides tool_calls in delta similar to OpenAI format
			const toolCalls = (delta as { toolCalls?: MistralToolCall[] })?.toolCalls
			if (toolCalls) {
				for (let i = 0; i < toolCalls.length; i++) {
					const toolCall = toolCalls[i]
					yield {
						type: "tool_call_partial",
						index: i,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (event.data.usage) {
				yield {
					type: "usage",
					inputTokens: event.data.usage.promptTokens || 0,
					outputTokens: event.data.usage.completionTokens || 0,
				}
			}
		}
	}

	/**
	 * Convert OpenAI tool definitions to Mistral format.
	 * Mistral uses the same format as OpenAI for function tools.
	 */
	private convertToolsForMistral(tools: OpenAI.Chat.ChatCompletionTool[]): MistralTool[] {
		return tools
			.filter((tool) => tool.type === "function")
			.map((tool) => ({
				type: "function" as const,
				function: {
					name: tool.function.name,
					description: tool.function.description,
					// Mistral SDK requires parameters to be defined, use empty object as fallback
					parameters: (tool.function.parameters as Record<string, unknown>) || {},
				},
			}))
	}

	override getModel() {
		const id = this.options.apiModelId ?? mistralDefaultModelId
		const info = mistralModels[id as MistralModelId] ?? mistralModels[mistralDefaultModelId]

		// @TODO: Move this to the `getModelParams` function.
		const maxTokens = this.options.includeMaxTokens ? info.maxTokens : undefined
		const temperature = this.options.modelTemperature ?? MISTRAL_DEFAULT_TEMPERATURE

		return { id, info, maxTokens, temperature }
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: model, temperature } = this.getModel()

		try {
			const response = await this.client.chat.complete({
				model,
				messages: [{ role: "user", content: prompt }],
				temperature,
			})

			const content = response.choices?.[0]?.message.content

			if (Array.isArray(content)) {
				// Only return text content, filter out thinking content for non-streaming
				return (content as ContentChunkWithThinking[])
					.filter((c) => c.type === "text" && c.text)
					.map((c) => c.text || "")
					.join("")
			}

			return content || ""
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, model, "completePrompt")
			TelemetryService.instance.captureException(apiError)
			throw new Error(`Mistral completion error: ${errorMessage}`)
		}
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
