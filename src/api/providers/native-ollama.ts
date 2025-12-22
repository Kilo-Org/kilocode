import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { Message, Ollama, Tool as OllamaTool, type Config as OllamaOptions } from "ollama"
import {
	ModelInfo,
	openAiModelInfoSaneDefaults,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	ollamaDefaultModelInfo,
} from "@roo-code/types"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import type { ApiHandlerOptions } from "../../shared/api"
import { getOllamaModels } from "./fetchers/ollama"
import { XmlMatcher } from "../../utils/xml-matcher"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

// kilocode_change start
import { fetchWithTimeout, HeadersTimeoutError } from "./kilocode/fetchWithTimeout"
import { getApiRequestTimeout } from "./utils/timeout-config"

const TOKEN_ESTIMATION_FACTOR = 4 //Industry standard technique for estimating token counts without actually implementing a parser/tokenizer

function estimateOllamaTokenCount(messages: Message[]): number {
	const totalChars = messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0)
	return Math.ceil(totalChars / TOKEN_ESTIMATION_FACTOR)
}
// kilocode_change end

interface OllamaChatOptions {
	temperature: number
	num_ctx?: number
}

function convertToOllamaMessages(anthropicMessages: Anthropic.Messages.MessageParam[]): Message[] {
	const ollamaMessages: Message[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			ollamaMessages.push({
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			})
		} else {
			if (anthropicMessage.role === "user") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool result messages FIRST since they must follow the tool use messages
				const toolResultImages: string[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the Ollama SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										// Handle base64 images only (Anthropic SDK uses base64)
										// Ollama expects raw base64 strings, not data URLs
										if ("source" in part && part.source.type === "base64") {
											toolResultImages.push(part.source.data)
										}
										return "(see following user message for image)"
									}
									return part.text
								})
								.join("\n") ?? ""
					}
					ollamaMessages.push({
						role: "user",
						images: toolResultImages.length > 0 ? toolResultImages : undefined,
						content: content,
					})
				})

				// Process non-tool messages
				if (nonToolMessages.length > 0) {
					// Separate text and images for Ollama
					const textContent = nonToolMessages
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n")

					const imageData: string[] = []
					nonToolMessages.forEach((part) => {
						if (part.type === "image" && "source" in part && part.source.type === "base64") {
							// Ollama expects raw base64 strings, not data URLs
							imageData.push(part.source.data)
						}
					})

					ollamaMessages.push({
						role: "user",
						content: textContent,
						images: imageData.length > 0 ? imageData : undefined,
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // assistant cannot send tool_result messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages
				let content: string = ""
				if (nonToolMessages.length > 0) {
					content = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								return "" // impossible as the assistant cannot send images
							}
							return part.text
						})
						.join("\n")
				}

				// Convert tool_use blocks to Ollama tool_calls format
				const toolCalls =
					toolMessages.length > 0
						? toolMessages.map((tool) => ({
								function: {
									name: tool.name,
									arguments: tool.input as Record<string, unknown>,
								},
							}))
						: undefined

				ollamaMessages.push({
					role: "assistant",
					content,
					tool_calls: toolCalls,
				})
			}
		}
	}

	return ollamaMessages
}

export class NativeOllamaHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: Ollama | undefined
	protected models: Record<string, ModelInfo> = {}
	private isInitialized = false // kilocode_change
	private modelFetchError: string | null = null // kilocode_change - track fetch errors for better diagnostics
	private initializationPromise: Promise<void> | null = null // kilocode_change - prevent race condition

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.initializationPromise = this.initialize() // kilocode_change - store the promise
	}

	// kilocode_change start
	private async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}
		await this.fetchModel()
		this.isInitialized = true
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initializationPromise) {
			await this.initializationPromise
		}
	}
	// kilocode_change end

	private ensureClient(): Ollama {
		if (!this.client) {
			try {
				// kilocode_change start
				const headers = this.options.ollamaApiKey
					? { Authorization: `Bearer ${this.options.ollamaApiKey}` }
					: undefined
				// kilocode_change end

				const timeout = getApiRequestTimeout() // kilocode_change
				this.client = new Ollama({
					host: this.options.ollamaBaseUrl || "http://localhost:11434",
					// kilocode_change start
					fetch: timeout ? fetchWithTimeout(timeout, headers) : undefined,
					headers: headers,
					// kilocode_change end
				})
			} catch (error: any) {
				throw new Error(`Error creating Ollama client: ${error.message}`)
			}
		}
		return this.client
	}

	/**
	 * Converts OpenAI-format tools to Ollama's native tool format.
	 * This allows NativeOllamaHandler to use the same tool definitions
	 * that are passed to OpenAI-compatible providers.
	 */
	private convertToolsToOllama(tools: OpenAI.Chat.ChatCompletionTool[] | undefined): OllamaTool[] | undefined {
		if (!tools || tools.length === 0) {
			return undefined
		}

		return tools
			.filter((tool): tool is OpenAI.Chat.ChatCompletionTool & { type: "function" } => tool.type === "function")
			.map((tool) => ({
				type: tool.type,
				function: {
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters as OllamaTool["function"]["parameters"],
				},
			}))
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// kilocode_change start
		await this.ensureInitialized()
		// kilocode_change end

		const client = this.ensureClient()
		const { id: modelId, info: modelInfo } = this.getModel() // kilocode_change: fetchModel => getModel
		const useR1Format = modelId.toLowerCase().includes("deepseek-r1")

		const ollamaMessages: Message[] = [
			{ role: "system", content: systemPrompt },
			...convertToOllamaMessages(messages),
		]

		// kilocode_change start
		// it is tedious we have to check this, but Ollama's quiet prompt-truncating behavior is a support nightmare otherwise
		const estimatedTokenCount = estimateOllamaTokenCount(ollamaMessages)
		const maxTokens = this.options.ollamaNumCtx ?? modelInfo.contextWindow
		if (estimatedTokenCount > maxTokens) {
			throw new Error(
				`Prompt is too long (estimated tokens: ${estimatedTokenCount}, max tokens: ${maxTokens}). Increase the Context Window Size in Settings.`,
			)
		}
		// kilocode_change end

		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		// Check if we should use native tool calling
		const supportsNativeTools = modelInfo.supportsNativeTools ?? false
		const useNativeTools =
			supportsNativeTools && metadata?.tools && metadata.tools.length > 0 && metadata?.toolProtocol !== "xml"

		try {
			// Build options object conditionally
			const chatOptions: OllamaChatOptions = {
				temperature: this.options.modelTemperature ?? (useR1Format ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
			}

			// Only include num_ctx if explicitly set via ollamaNumCtx
			if (this.options.ollamaNumCtx !== undefined) {
				chatOptions.num_ctx = this.options.ollamaNumCtx
			}

			// Create the actual API request promise
			const stream = await client.chat({
				model: modelId,
				messages: ollamaMessages,
				stream: true,
				options: chatOptions,
				// Native tool calling support
				...(useNativeTools && { tools: this.convertToolsToOllama(metadata.tools) }),
			})

			let totalInputTokens = 0
			let totalOutputTokens = 0
			// Track tool calls across chunks (Ollama may send complete tool_calls in final chunk)
			let toolCallIndex = 0

			try {
				for await (const chunk of stream) {
					if (typeof chunk.message.content === "string" && chunk.message.content.length > 0) {
						// Process content through matcher for reasoning detection
						for (const matcherChunk of matcher.update(chunk.message.content)) {
							yield matcherChunk
						}
					}

					// Handle tool calls - emit partial chunks for NativeToolCallParser compatibility
					if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
						for (const toolCall of chunk.message.tool_calls) {
							// Generate a unique ID for this tool call
							const toolCallId = `ollama-tool-${toolCallIndex}`
							yield {
								type: "tool_call_partial",
								index: toolCallIndex,
								id: toolCallId,
								name: toolCall.function.name,
								arguments: JSON.stringify(toolCall.function.arguments),
							}
							toolCallIndex++
						}
					}

					// Handle token usage if available
					if (chunk.eval_count !== undefined || chunk.prompt_eval_count !== undefined) {
						if (chunk.prompt_eval_count) {
							totalInputTokens = chunk.prompt_eval_count
						}
						if (chunk.eval_count) {
							totalOutputTokens = chunk.eval_count
						}
					}
				}

				// Yield any remaining content from the matcher
				for (const chunk of matcher.final()) {
					yield chunk
				}

				// Yield usage information if available
				if (totalInputTokens > 0 || totalOutputTokens > 0) {
					yield {
						type: "usage",
						inputTokens: totalInputTokens,
						outputTokens: totalOutputTokens,
					}
				}
			} catch (streamError: any) {
				console.error("Error processing Ollama stream:", streamError)
				throw new Error(`Ollama stream processing error: ${streamError.message || "Unknown error"}`)
			}
		} catch (error: any) {
			// Enhance error reporting
			const statusCode = error.status || error.statusCode
			const errorMessage = error.message || "Unknown error"

			// kilocode_change start
			if (error.cause instanceof HeadersTimeoutError) {
				throw new Error("Headers timeout", { cause: error })
			}
			// kilocode_change end

			if (error.code === "ECONNREFUSED") {
				throw new Error(
					`Ollama service is not running at ${this.options.ollamaBaseUrl || "http://localhost:11434"}. Please start Ollama first.`,
				)
			} else if (statusCode === 404) {
				throw new Error(
					`Model ${this.getModel().id} not found in Ollama. Please pull the model first with: ollama pull ${this.getModel().id}`,
				)
			}

			console.error(`Ollama API error (${statusCode || "unknown"}): ${errorMessage}`)
			throw error
		}
	}

	async fetchModel() {
		// kilocode_change start
		try {
			this.modelFetchError = null
			this.models = await getOllamaModels(
				this.options.ollamaBaseUrl,
				this.options.ollamaApiKey,
				this.options.ollamaNumCtx,
			)
			if (Object.keys(this.models).length === 0) {
				this.modelFetchError = "noModelsReturned"
			}
		} catch (error: any) {
			this.modelFetchError = error.message || "unknownError"
			this.models = {}
		}
		return this.models
		// kilocode_change end
	}

	override getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.ollamaModelId || ""
		const userContextWindow = this.options.ollamaNumCtx

		// kilocode_change start
		// If not yet initialized, return default model info to allow getEnvironmentDetails to work
		// The actual model validation will happen in createMessage() after ensureInitialized()
		if (!this.isInitialized) {
			const contextWindow = userContextWindow || ollamaDefaultModelInfo.contextWindow
			return {
				id: modelId,
				info: {
					...ollamaDefaultModelInfo,
					contextWindow: contextWindow,
				},
			}
		}

		const modelInfo = this.models[modelId]
		if (!modelInfo) {
			const availableModels = Object.keys(this.models)
			if (availableModels.length > 0) {
				throw new Error(`Model ${modelId} not found. Available models: ${availableModels.join(", ")}`)
			}

			const baseUrl = this.options.ollamaBaseUrl || "http://localhost:11434"
			const troubleshooting = [
				`1. Ensure Ollama is running (try: ollama serve)`,
				`2. Verify the base URL is correct: ${baseUrl}`,
				`3. Check that models are installed (try: ollama list)`,
				`4. Pull the model if needed: ollama pull ${modelId}`,
			].join("\n")

			throw new Error(
				`Model ${modelId} not found. Could not retrieve models from Ollama.\n\nTroubleshooting:\n${troubleshooting}`,
			)
		}

		// Override contextWindow with user's setting if provided
		const finalModelInfo = userContextWindow ? { ...modelInfo, contextWindow: userContextWindow } : modelInfo
		// kilocode_change end

		return {
			id: modelId,
			info: finalModelInfo, // kilocode_change
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			// kilocode_change start
			await this.ensureInitialized()
			// kilocode_change end

			const client = this.ensureClient()
			const { id: modelId } = this.getModel() // kilocode_change: fetchModel => getModel
			const useR1Format = modelId.toLowerCase().includes("deepseek-r1")

			// Build options object conditionally
			const chatOptions: OllamaChatOptions = {
				temperature: this.options.modelTemperature ?? (useR1Format ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
			}

			// Only include num_ctx if explicitly set via ollamaNumCtx
			if (this.options.ollamaNumCtx !== undefined) {
				chatOptions.num_ctx = this.options.ollamaNumCtx
			}

			const response = await client.chat({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				stream: false,
				options: chatOptions,
			})

			return response.message?.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Ollama completion error: ${error.message}`)
			}
			throw error
		}
	}
}
