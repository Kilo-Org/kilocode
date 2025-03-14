import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"
import { anthropicDefaultModelId, anthropicModels, ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "./constants"
import { SingleCompletionHandler, getModelParams } from "../index"

export class KiloCodeHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new Anthropic({
			authToken: this.options.kilocodeToken,
			baseURL: "https://kilocode.ai/api/claude/",
		})
	}

	private getIdempotencyKey(taskId: string, checkpointNumber: number): string {
		// Create a deterministic idempotency key based on task_id and checkpoint number
		return `${taskId}-${checkpointNumber}`
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		taskId?: string,
		checkpointNumber?: number,
	): ApiStream {
		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
		const cacheControl: CacheControlEphemeral = { type: "ephemeral" }
		const { id: modelId, maxTokens, thinking, temperature, virtualId } = this.getModel()

		// Use a for loop instead of reduce with spread to avoid linting error
		const userMsgIndices: number[] = []
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].role === "user") {
				userMsgIndices.push(i)
			}
		}

		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Prepare request options with headers
		const requestOptions: { headers: Record<string, string> } = (() => {
			const betas: string[] = []

			// Check for models that support prompt caching
			switch (modelId) {
				case "claude-3-7-sonnet-20250219":
				case "claude-3-5-sonnet-20241022":
				case "claude-3-5-haiku-20241022":
				case "claude-3-opus-20240229":
				case "claude-3-haiku-20240307":
					betas.push("prompt-caching-2024-07-31")
					break
			}

			const headers: Record<string, string> = {}

			// Add beta features if any
			if (betas.length > 0) {
				headers["anthropic-beta"] = betas.join(",")
			}

			// Add idempotency key if task_id and checkpoint number are provided
			if (taskId && checkpointNumber !== undefined) {
				headers["idempotency-key"] = this.getIdempotencyKey(taskId, checkpointNumber)
			}

			return { headers }
		})()

		stream = await this.client.messages.create(
			{
				model: modelId,
				max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
				temperature,
				thinking,
				// Setting cache breakpoint for system prompt so new tasks can reuse it.
				system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
				messages: messages.map((message, index) => {
					if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
						return {
							...message,
							content:
								typeof message.content === "string"
									? [{ type: "text", text: message.content, cache_control: cacheControl }]
									: message.content.map((content, contentIndex) =>
											contentIndex === message.content.length - 1
												? { ...content, cache_control: cacheControl }
												: content,
										),
						}
					}
					return message
				}),
				// tools, // cache breakpoints go from tools > system > messages, and since tools dont change, we can just set the breakpoint at the end of system (this avoids having to set a breakpoint at the end of tools which by itself does not meet min requirements for haiku caching)
				// tool_choice: { type: "auto" },
				// tools: tools,
				stream: true,
			},
			requestOptions,
		)

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start": {
					// Tells us cache reads/writes/input/output.
					const usage = chunk.message.usage

					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}

					break
				}
				case "message_delta":
					// Tells us stop_reason, stop_sequence, and output tokens
					// along the way and at the end of the message.
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}

					break
				case "message_stop":
					// No usage data, just an indicator that the message is done.
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							// We may receive multiple text blocks, in which
							// case just insert a line break between them.
							if (chunk.index > 0) {
								yield { type: "reasoning", text: "\n" }
							}

							yield { type: "reasoning", text: chunk.content_block.thinking }
							break
						case "text":
							// We may receive multiple text blocks, in which
							// case just insert a line break between them.
							if (chunk.index > 0) {
								yield { type: "text", text: "\n" }
							}

							yield { type: "text", text: chunk.content_block.text }
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							yield { type: "reasoning", text: chunk.delta.thinking }
							break
						case "text_delta":
							yield { type: "text", text: chunk.delta.text }
							break
					}

					break
				case "content_block_stop":
					break
			}
		}
	}

	getModel() {
		// Always use the default model, ignoring any user-provided model ID
		const id = anthropicDefaultModelId
		const info: ModelInfo = anthropicModels[id]

		// Track the original model ID for special variant handling
		const virtualId = id

		return {
			id,
			info,
			virtualId,
			...getModelParams({ options: this.options, model: info, defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS }),
		}
	}

	async completePrompt(prompt: string, taskId?: string, checkpointNumber?: number) {
		const { id: modelId, temperature } = this.getModel()

		// Prepare request options with headers
		const requestOptions: { headers: Record<string, string> } = {
			headers: {},
		}

		// Add idempotency key if task_id and checkpoint number are provided
		if (taskId && checkpointNumber !== undefined) {
			requestOptions.headers["idempotency-key"] = this.getIdempotencyKey(taskId, checkpointNumber)
		}

		const message = await this.client.messages.create(
			{
				model: modelId,
				max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
				thinking: undefined,
				temperature,
				messages: [{ role: "user", content: prompt }],
				stream: false,
			},
			requestOptions,
		)

		const content = message.content.find(({ type }) => type === "text")
		return content?.type === "text" ? content.text : ""
	}

	/**
	 * Counts tokens for the given content using Anthropic's API
	 *
	 * @param content The content blocks to count tokens for
	 * @returns A promise resolving to the token count
	 */
	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			// Use the current model
			const actualModelId = this.getModel().id

			const response = await this.client.messages.countTokens({
				model: actualModelId,
				messages: [
					{
						role: "user",
						content: content,
					},
				],
			})

			return response.input_tokens
		} catch (error) {
			// Log error but fallback to tiktoken estimation
			console.warn("Anthropic token counting failed, using fallback", error)

			// Use the base provider's implementation as fallback
			return super.countTokens(content)
		}
	}
}
