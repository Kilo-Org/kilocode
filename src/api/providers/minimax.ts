import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"

import {
	type ModelInfo,
	MINIMAX_DEFAULT_MAX_TOKENS,
	MINIMAX_DEFAULT_TEMPERATURE,
	MinimaxModelId,
	minimaxDefaultModelId,
	minimaxModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { calculateApiCostAnthropic } from "../../shared/cost"

export class MiniMaxHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		this.client = new Anthropic({
			baseURL: this.options.minimaxBaseUrl || "https://api.minimax.io/anthropic",
			apiKey: this.options.minimaxApiKey,
		})
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
		let { id: modelId, maxTokens } = this.getModel()

		stream = await this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens ?? MINIMAX_DEFAULT_MAX_TOKENS,
			temperature: MINIMAX_DEFAULT_TEMPERATURE,
			system: [{ text: systemPrompt, type: "text" }],
			messages,
			stream: true,
		})

		let inputTokens = 0
		let outputTokens = 0
		let cacheWriteTokens = 0
		let cacheReadTokens = 0
		let thinkingDeltaAccumulator = ""
		let thinkText = ""
		let thinkSignature = ""
		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start": {
					// Tells us cache reads/writes/input/output.
					const {
						input_tokens = 0,
						output_tokens = 0,
						cache_creation_input_tokens,
						cache_read_input_tokens,
					} = chunk.message.usage

					yield {
						type: "usage",
						inputTokens: input_tokens,
						outputTokens: output_tokens,
						cacheWriteTokens: cache_creation_input_tokens || undefined,
						cacheReadTokens: cache_read_input_tokens || undefined,
					}

					inputTokens += input_tokens
					outputTokens += output_tokens
					cacheWriteTokens += cache_creation_input_tokens || 0
					cacheReadTokens += cache_read_input_tokens || 0

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
							thinkText = chunk.content_block.thinking
							thinkSignature = chunk.content_block.signature
							if (thinkText && thinkSignature) {
								yield {
									type: "ant_thinking",
									thinking: thinkText,
									signature: thinkSignature,
								}
							}
							break
						case "redacted_thinking":
							// Content is encrypted, and we don't want to pass placeholder text back to the API
							yield {
								type: "reasoning",
								text: "[Redacted thinking block]",
							}
							yield {
								type: "ant_redacted_thinking",
								data: chunk.content_block.data,
							}
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
							thinkingDeltaAccumulator += chunk.delta.thinking
							break
						case "signature_delta":
							// It's used when sending the thinking block back to the API
							// API expects this in completed form, not as array of deltas
							if (thinkingDeltaAccumulator && chunk.delta.signature) {
								yield {
									type: "ant_thinking",
									thinking: thinkingDeltaAccumulator,
									signature: chunk.delta.signature,
								}
							}
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

		if (inputTokens > 0 || outputTokens > 0 || cacheWriteTokens > 0 || cacheReadTokens > 0) {
			yield {
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
				totalCost: calculateApiCostAnthropic(
					this.getModel().info,
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
				),
			}
		}
	}

	getModel() {
		const modelId = this.options.apiModelId
		let id = modelId && modelId in minimaxModels ? (modelId as MinimaxModelId) : minimaxDefaultModelId
		let info: ModelInfo = minimaxModels[id]

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
		})

		// The `:thinking` suffix indicates that the model is a "Hybrid"
		// reasoning model and that reasoning is required to be enabled.
		// The actual model ID honored by Anthropic's API does not have this
		// suffix.
		return {
			id,
			info,
			...params,
		}
	}

	async completePrompt(prompt: string) {
		let { id: model } = this.getModel()

		const message = await this.client.messages.create({
			model,
			max_tokens: MINIMAX_DEFAULT_MAX_TOKENS,
			thinking: undefined,
			temperature: MINIMAX_DEFAULT_TEMPERATURE,
			messages: [{ role: "user", content: prompt }],
			stream: false,
		})

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
			const { id: model } = this.getModel()

			const response = await this.client.messages.countTokens({
				model,
				messages: [{ role: "user", content: content }],
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
