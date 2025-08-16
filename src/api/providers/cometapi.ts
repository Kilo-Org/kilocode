import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { cometApiDefaultModelId, cometApiModels } from "@roo-code/types"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { getCometAPIModels } from "./fetchers/cometapi"
import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from "../index"

// See `OpenAI.Chat.Completions.ChatCompletionChunk["usage"]`
// `CompletionsAPI.CompletionUsage`
// Following OpenRouter's CompletionUsage interface structure
export interface CompletionUsage {
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
	is_byok?: boolean
	cost_details?: {
		upstream_inference_cost?: number
	}
}

export class CometAPIHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.cometApiBaseUrl || "https://api.cometapi.com/v1"
		const apiKey = this.options.cometApiKey ?? "not-provided"

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: DEFAULT_HEADERS })
	}

	customRequestOptions(_metadata?: ApiHandlerCreateMessageMetadata): OpenAI.RequestOptions | undefined {
		return undefined
	}

	getTotalCost(lastUsage: CompletionUsage): number {
		return (lastUsage.cost_details?.upstream_inference_cost || 0) + (lastUsage.cost || 0)
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		let { id: modelId, maxTokens, temperature } = model

		// Convert Anthropic messages to OpenAI format.
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
			temperature,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
		}

		let stream
		const requestOptions = this.customRequestOptions(metadata)


		// Create completion stream

		stream = await this.client.chat.completions.create(
			completionParams,
			...(requestOptions ? [requestOptions] : []),
		)

		let lastUsage: CompletionUsage | undefined = undefined

		try {
			for await (const chunk of stream) {
				// CometAPI returns an error object instead of the OpenAI SDK throwing an error.
				if ("error" in chunk) {
					const error = chunk.error as { message?: string; code?: number }
					console.error(`CometAPI Error: ${error?.code} - ${error?.message}`)
					throw new Error(`CometAPI Error ${error?.code}: ${error?.message}`)
				}

				const delta = chunk.choices[0]?.delta

				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}
		} catch (error) {
			let errorMessage = makeCometAPIErrorReadable(error)
			throw new Error(errorMessage)
		}

		if (lastUsage) {
			yield {
				type: "usage",
				inputTokens: lastUsage.prompt_tokens || 0,
				outputTokens: lastUsage.completion_tokens || 0,
				cacheReadTokens: lastUsage.prompt_tokens_details?.cached_tokens,
				reasoningTokens: lastUsage.completion_tokens_details?.reasoning_tokens,
				totalCost: this.getTotalCost(lastUsage),
			}
		}
	}

	public async fetchModel() {
		this.models = await getCometAPIModels(this.options)
		return this.getModel()
	}

	override getModel() {
		const id = this.options.cometApiModelId ?? cometApiDefaultModelId
		const info = this.models[id] ?? cometApiModels[cometApiDefaultModelId]

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return { id, info, ...params }
	}

	async completePrompt(prompt: string) {
		let { id: modelId, maxTokens, temperature } = await this.fetchModel()

		const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
		}


		// Create completion
		const completion = await this.client.chat.completions.create(completionParams)

		if ("error" in completion) {
			const error = completion.error as { message?: string; code?: number }
			throw new Error(`CometAPI Error ${error?.code}: ${error?.message}`)
		}

		return (completion as OpenAI.Chat.ChatCompletion).choices[0]?.message?.content || ""

	}
}

function makeCometAPIErrorReadable(error: any) {
	if (error?.code !== 429 && error?.code !== 418) {
		return `CometAPI Error: ${error?.message || error}`
	}

	try {
		const parsedJson = JSON.parse(error.error.metadata?.raw)
		const retryAfter = parsedJson?.error?.details.map((detail: any) => detail.retryDelay).filter((r: any) => r)[0]
		if (retryAfter) {
			return `Rate limit exceeded, try again in ${retryAfter}.`
		}
	} catch (e) {}

	return `Rate limit exceeded, try again later.\n${error?.message || error}`
}
