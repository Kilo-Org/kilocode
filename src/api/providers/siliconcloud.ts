import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	siliconCloudApiLineConfigs,
	siliconCloudDefaultModelId,
	siliconCloudDefaultApiLine,
	siliconCloudModelsByApiLine,
} from "@roo-code/types"

import { type ApiHandlerOptions } from "../../shared/api"
import { type ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { ApiHandlerCreateMessageMetadata } from ".."
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class SiliconCloudHandler extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: ApiHandlerOptions) {
		const apiLine = options.siliconCloudApiLine || siliconCloudDefaultApiLine
		const baseURL = siliconCloudApiLineConfigs[apiLine].baseUrl
		const providerModels = siliconCloudModelsByApiLine[apiLine]

		super({
			...options,
			providerName: "SiliconCloud",
			baseURL,
			apiKey: options.siliconCloudApiKey,
			defaultProviderModelId: siliconCloudDefaultModelId,
			providerModels,
			defaultTemperature: 0,
		})
	}

	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const {
			id: model,
			info: { maxTokens: max_tokens, supportsReasoningBudget },
		} = this.getModel()

		const temperature = this.options.modelTemperature ?? this.defaultTemperature

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		}

		if (supportsReasoningBudget) {
			if (this.options.enableReasoningEffort) {
				// @ts-ignore
				params.enable_thinking = true
			}

			if (this.options.modelMaxThinkingTokens) {
				// @ts-ignore
				params.thinking_budget = this.options.modelMaxThinkingTokens
			}
		}

		try {
			return this.client.chat.completions.create(params, requestOptions)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(systemPrompt, messages, metadata)
		let lastUsage: OpenAI.CompletionUsage | undefined

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta ?? {}

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string | undefined) || "",
				}
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
}
