// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	APERTIS_DEFAULT_BASE_URL,
	apertisDefaultModelId,
	apertisDefaultModelInfo,
	APERTIS_RESPONSES_API_MODELS,
} from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"
import { ApiStreamChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import { getModels } from "./fetchers/modelCache"
import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"

type ApertisApiFormat = "messages" | "responses" | "chat"

export class ApertisHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private anthropicClient: Anthropic
	protected models: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.apertisBaseUrl || APERTIS_DEFAULT_BASE_URL
		const apiKey = this.options.apertisApiKey ?? "not-provided"

		// OpenAI client for /v1/chat/completions & /v1/responses
		this.client = new OpenAI({
			baseURL: `${baseURL}/v1`,
			apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})

		// Anthropic client for /v1/messages
		this.anthropicClient = new Anthropic({
			baseURL: `${baseURL}`,
			apiKey,
		})

		// Load models asynchronously
		this.loadDynamicModels().catch((error) => {
			console.error("[ApertisHandler] Failed to load dynamic models:", error)
		})
	}

	private async loadDynamicModels(): Promise<void> {
		try {
			this.models = await getModels({
				provider: "apertis",
				baseUrl: this.options.apertisBaseUrl,
			})
		} catch (error) {
			console.error("[ApertisHandler] Error loading dynamic models:", error)
		}
	}

	/**
	 * Determine which API format to use based on model ID
	 */
	private getApiFormat(modelId: string): ApertisApiFormat {
		// Claude models use Anthropic Messages API
		if (modelId.startsWith("claude-")) {
			return "messages"
		}
		// Reasoning models (o1, o3) use Responses API
		if (APERTIS_RESPONSES_API_MODELS.has(modelId) || modelId.startsWith("o1-") || modelId.startsWith("o3-")) {
			return "responses"
		}
		// All others use Chat Completions
		return "chat"
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const model = this.getModel()
		const format = this.getApiFormat(model.id)

		switch (format) {
			case "messages":
				yield* this.createAnthropicMessage(systemPrompt, messages, metadata)
				break
			case "responses":
				yield* this.createResponsesMessage(systemPrompt, messages, metadata)
				break
			default:
				yield* this.createChatMessage(systemPrompt, messages, metadata)
		}
	}

	/**
	 * Create message using Anthropic Messages API (/v1/messages)
	 */
	private async *createAnthropicMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const { id: modelId, maxTokens } = this.getModel()

		const stream = this.anthropicClient.messages.stream({
			model: modelId,
			max_tokens: maxTokens || 8192,
			system: systemPrompt,
			messages,
		})

		for await (const event of stream) {
			if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
				yield { type: "text", text: event.delta.text }
			}
		}

		const finalMessage = await stream.finalMessage()
		yield {
			type: "usage",
			inputTokens: finalMessage.usage.input_tokens,
			outputTokens: finalMessage.usage.output_tokens,
		}
	}

	/**
	 * Create message using OpenAI Chat Completions API (/v1/chat/completions)
	 */
	private async *createChatMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const { id: modelId, maxTokens, temperature } = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			max_tokens: maxTokens,
			temperature,
			stream: true,
			stream_options: { include_usage: true },
		})

		let lastUsage: OpenAI.CompletionUsage | undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield {
				type: "usage",
				inputTokens: lastUsage.prompt_tokens || 0,
				outputTokens: lastUsage.completion_tokens || 0,
			}
		}
	}

	/**
	 * Create message using OpenAI Responses API (/v1/responses)
	 */
	private async *createResponsesMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const { id: modelId } = this.getModel()
		const baseURL = this.options.apertisBaseUrl || APERTIS_DEFAULT_BASE_URL

		// Convert messages to input format for Responses API
		const input = messages.map((msg) => ({
			role: msg.role,
			content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
		}))

		const requestBody: Record<string, unknown> = {
			model: modelId,
			input,
			instructions: this.options.apertisInstructions || systemPrompt,
			stream: true,
		}

		// Add reasoning parameters if configured
		if (this.options.apertisReasoningEffort || this.options.apertisReasoningSummary) {
			requestBody.reasoning = {
				...(this.options.apertisReasoningEffort && { effort: this.options.apertisReasoningEffort }),
				...(this.options.apertisReasoningSummary && { summary: this.options.apertisReasoningSummary }),
			}
		}

		const response = await fetch(`${baseURL}/v1/responses`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.options.apertisApiKey}`,
				...DEFAULT_HEADERS,
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Apertis Responses API error: ${response.status} - ${errorText}`)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("No response body")
		}

		const decoder = new TextDecoder()
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = line.slice(6)
					if (data === "[DONE]") continue

					try {
						const parsed = JSON.parse(data)
						const content = parsed.choices?.[0]?.delta?.content
						if (content) {
							yield { type: "text", text: content }
						}
					} catch {
						// Skip invalid JSON
					}
				}
			}
		}
	}

	override getModel() {
		const id = this.options.apertisModelId ?? apertisDefaultModelId
		const info = this.models[id] ?? apertisDefaultModelInfo

		return {
			id,
			info,
			maxTokens: info.maxTokens ?? 8192,
			temperature: this.options.modelTemperature ?? 0,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, maxTokens, temperature } = this.getModel()

		const response = await this.client.chat.completions.create({
			model: modelId,
			messages: [{ role: "user", content: prompt }],
			max_tokens: maxTokens,
			temperature,
			stream: false,
		})

		return response.choices[0]?.message?.content || ""
	}
}
