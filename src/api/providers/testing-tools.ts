import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type TestingToolsModelId, testingToolsDefaultModelId, testingToolsModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"
import { handleOpenAIError } from "./utils/openai-error-handler"

const TESTING_TOOLS_DEFAULT_TEMPERATURE = 1.0

export class TestingToolsHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "testing-tools"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const apiKey = this.options.testingToolsApiKey ?? "not-provided"
		const baseURL = this.options.testingToolsBaseUrl || "https://api.x.ai/v1"

		this.client = new OpenAI({
			baseURL,
			apiKey: apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	override getModel() {
		const id =
			this.options.apiModelId && this.options.apiModelId in testingToolsModels
				? (this.options.apiModelId as TestingToolsModelId)
				: testingToolsDefaultModelId

		const info = testingToolsModels[id]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	override async *createMessage(
		_systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info: modelInfo, reasoning } = this.getModel()

		// Use custom model slug if provided, otherwise use the default model ID
		const effectiveModelSlug = this.options.testingToolsModelSlug || modelId

		// Override model info with custom values if provided
		const effectiveMaxTokens = this.options.testingToolsMaxTokens || modelInfo.maxTokens

		// Use system prompt override if provided, otherwise use empty string
		// IMPORTANT: We completely ignore the systemPrompt parameter passed in
		const effectiveSystemPrompt = this.options.testingToolsSystemPromptOverride || ""

		// Parse tools JSON if provided
		// IMPORTANT: We ONLY use tools from testingToolsToolsJson, never from metadata
		let tools: OpenAI.Chat.ChatCompletionTool[] | undefined
		if (this.options.testingToolsToolsJson) {
			try {
				tools = JSON.parse(this.options.testingToolsToolsJson)
			} catch (error) {
				console.error("Failed to parse tools JSON:", error)
				// Continue without tools if parsing fails
			}
		}

		// Determine if we should stream
		const shouldStream = false // Set to false for non-streaming, or make configurable

		let stream
		try {
			const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
				model: effectiveModelSlug,
				max_tokens: effectiveMaxTokens,
				temperature: TESTING_TOOLS_DEFAULT_TEMPERATURE,
				messages: [
					...(effectiveSystemPrompt ? [{ role: "system" as const, content: effectiveSystemPrompt }] : []),
					...convertToOpenAiMessages(messages),
				],
				stream: shouldStream,
				...(shouldStream ? { stream_options: { include_usage: true } } : {}),
				...(reasoning && reasoning),
			}

			// ONLY add tools if explicitly provided in testingToolsToolsJson
			if (tools && tools.length > 0) {
				requestParams.tools = tools
				requestParams.parallel_tool_calls = false
			}

			stream = await this.client.chat.completions.create(requestParams)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		// Handle both streaming and non-streaming responses
		if (shouldStream) {
			// Streaming response - iterate over chunks
			for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
				verifyFinishReason(chunk.choices[0])
				const delta = chunk.choices[0]?.delta

				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (delta && "reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						text: delta.reasoning_content as string,
					}
				}

				// Handle native OpenAI-format tool calls
				if (delta && delta.tool_calls && delta.tool_calls.length > 0) {
					console.debug("[TestingTools] Yielding native tool calls:", {
						count: delta.tool_calls.length,
						tools: delta.tool_calls.map((tc: any) => tc.function?.name).filter(Boolean),
					})
					yield {
						type: "native_tool_calls",
						toolCalls: delta.tool_calls.map((tc: any) => ({
							id: tc.id,
							type: tc.type,
							function: tc.function
								? {
										name: tc.function.name,
										arguments: tc.function.arguments,
									}
								: undefined,
						})),
					}
				}

				if (chunk.usage) {
					const promptDetails =
						"prompt_tokens_details" in chunk.usage ? chunk.usage.prompt_tokens_details : null
					const cachedTokens =
						promptDetails && "cached_tokens" in promptDetails ? promptDetails.cached_tokens : 0

					const readTokens =
						cachedTokens ||
						("cache_read_input_tokens" in chunk.usage ? (chunk.usage as any).cache_read_input_tokens : 0)
					const writeTokens =
						"cache_creation_input_tokens" in chunk.usage
							? (chunk.usage as any).cache_creation_input_tokens
							: 0

					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						cacheReadTokens: readTokens,
						cacheWriteTokens: writeTokens,
					}
				}
			}
		} else {
			// Non-streaming response - handle complete response
			const response = stream as OpenAI.Chat.ChatCompletion
			const choice = response.choices[0]

			if (choice) {
				// Yield complete content
				if (choice.message.content) {
					yield {
						type: "text",
						text: choice.message.content,
					}
				}

				// Handle reasoning content if present
				if ("reasoning_content" in choice.message && (choice.message as any).reasoning_content) {
					yield {
						type: "reasoning",
						text: (choice.message as any).reasoning_content as string,
					}
				}

				// Handle tool calls
				if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
					console.debug("[TestingTools] Yielding native tool calls:", {
						count: choice.message.tool_calls.length,
						tools: choice.message.tool_calls
							.map((tc) => (tc.type === "function" && "function" in tc ? tc.function?.name : undefined))
							.filter(Boolean),
					})
					yield {
						type: "native_tool_calls",
						toolCalls: choice.message.tool_calls.map((tc) => ({
							id: tc.id,
							type: tc.type,
							function:
								tc.type === "function" && "function" in tc
									? {
											name: tc.function.name,
											arguments: tc.function.arguments,
										}
									: undefined,
						})),
					}
				}
			}

			// Handle usage
			if (response.usage) {
				const promptDetails =
					"prompt_tokens_details" in response.usage ? response.usage.prompt_tokens_details : null
				const cachedTokens =
					promptDetails && "cached_tokens" in promptDetails ? (promptDetails as any).cached_tokens : 0

				const readTokens =
					cachedTokens ||
					("cache_read_input_tokens" in response.usage ? (response.usage as any).cache_read_input_tokens : 0)
				const writeTokens =
					"cache_creation_input_tokens" in response.usage
						? (response.usage as any).cache_creation_input_tokens
						: 0

				yield {
					type: "usage",
					inputTokens: response.usage.prompt_tokens || 0,
					outputTokens: response.usage.completion_tokens || 0,
					cacheReadTokens: readTokens,
					cacheWriteTokens: writeTokens,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, reasoning } = this.getModel()

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				...(reasoning && reasoning),
			})

			return response.choices[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}
}
