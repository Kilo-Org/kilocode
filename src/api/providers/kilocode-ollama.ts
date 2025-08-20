import { Anthropic } from "@anthropic-ai/sdk"
import { Message, Ollama } from "ollama"
import { ModelInfo, openAiModelInfoSaneDefaults } from "@roo-code/types"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { ModelRecord } from "../../shared/api"
import { getModels } from "./fetchers/modelCache"
import { fetchWithTimeout } from "./kilocode/fetchWithTimeout"

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
										toolResultImages.push(
											part.source.type === "url"
												? part.source.url
												: `data:${part.source.media_type};base64,${part.source.data}`,
										)
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
					ollamaMessages.push({
						role: "user",
						content: nonToolMessages
							.map((part) => {
								if (part.type === "image") {
									return part.source.type === "url"
										? part.source.url
										: `data:${part.source.media_type};base64,${part.source.data}`
								}
								return part.text
							})
							.join("\n"),
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages } = anthropicMessage.content.reduce<{
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

				ollamaMessages.push({
					role: "assistant",
					content,
				})
			}
		}
	}

	return ollamaMessages
}

const OLLAMA_TIMEOUT_MS = 3_600_000

interface OllamaHandlerOptions {
	ollamaBaseUrl?: string
	ollamaModelId?: string
	ollamaApiKey?: string
}

export class KilocodeOllamaHandler extends BaseProvider {
	private options: OllamaHandlerOptions
	private client: Ollama | undefined
	protected models: ModelRecord = {}

	constructor(options: OllamaHandlerOptions) {
		super()
		this.options = options
	}

	private ensureClient(): Ollama {
		if (!this.client) {
			try {
				const headers = this.options.ollamaApiKey
					? { Authorization: this.options.ollamaApiKey } //Yes, this is weird, its not a Bearer token
					: undefined

				this.client = new Ollama({
					host: this.options.ollamaBaseUrl || "http://localhost:11434",
					fetch: fetchWithTimeout(OLLAMA_TIMEOUT_MS, headers),
					headers: headers,
				})
			} catch (error) {
				throw new Error(`Error creating Ollama client: ${error.message}`)
			}
		}
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const ollamaMessages: Message[] = [
			{ role: "system", content: systemPrompt },
			...convertToOllamaMessages(messages),
		]

		try {
			// Create the actual API request promise
			const model = this.getModel()
			const stream = await client.chat({
				model: model.id,
				messages: ollamaMessages,
				stream: true,
				options: {
					num_ctx: model.info.contextWindow,
				},
			})

			try {
				for await (const chunk of stream) {
					if (typeof chunk.message.content === "string") {
						yield {
							type: "text",
							text: chunk.message.content,
						}
					}

					// Handle token usage if available
					if (chunk.eval_count !== undefined || chunk.prompt_eval_count !== undefined) {
						yield {
							type: "usage",
							inputTokens: chunk.prompt_eval_count || 0,
							outputTokens: chunk.eval_count || 0,
						}
					}
				}
			} catch (streamError) {
				console.error("Error processing Ollama stream:", streamError)
				throw new Error(`Ollama stream processing error: ${streamError.message || "Unknown error"}`)
			}
		} catch (error) {
			// Enhance error reporting
			const statusCode = error.status || error.statusCode
			const errorMessage = error.message || "Unknown error"

			console.error(`Ollama API error (${statusCode || "unknown"}): ${errorMessage}`)
			throw error
		}
	}

	async fetchModel() {
		this.models = await getModels({ provider: "ollama", baseUrl: this.options.ollamaBaseUrl })
		return this.getModel()
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.ollamaModelId || ""
		return {
			id: modelId,
			info: this.models[modelId] || openAiModelInfoSaneDefaults,
		}
	}
}
