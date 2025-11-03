import {
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	type ChutesModelId,
	chutesDefaultModelId,
	chutesModels,
	getActiveToolUseStyle, // kilocode_change
} from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../shared/api"
import { XmlMatcher } from "../../utils/xml-matcher"
import { convertToR1Format } from "../transform/r1-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { addNativeToolCallsToParams, processNativeToolCallsFromDelta } from "./kilocode/nativeToolCallHelpers"
import { ApiHandlerCreateMessageMetadata } from ".." // kilocode_change

export class ChutesHandler extends BaseOpenAiCompatibleProvider<ChutesModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Chutes",
			baseURL: "https://llm.chutes.ai/v1",
			apiKey: options.chutesApiKey,
			defaultProviderModelId: chutesDefaultModelId,
			providerModels: chutesModels,
			defaultTemperature: 0.5,
		})
	}

	private getCompletionParams(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata, // kilocode_change
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
		const {
			id: model,
			info: { maxTokens: max_tokens },
		} = this.getModel()

		const temperature = this.options.modelTemperature ?? this.getModel().info.temperature

		// kilocode_change start: addNativeToolCallsToParams
		return addNativeToolCallsToParams(
			{
				model,
				max_tokens,
				temperature,
				messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				stream: true,
				stream_options: { include_usage: true },
			},
			this.options,
			metadata,
		)
		// kilocode_change end
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata, // kilocode_change
	): ApiStream {
		const model = this.getModel()

		if (model.id.includes("DeepSeek-R1")) {
			const stream = await this.client.chat.completions.create({
				...this.getCompletionParams(
					systemPrompt,
					messages,
					metadata, // kilocode_change
				),
				messages: convertToR1Format([{ role: "user", content: systemPrompt }, ...messages]),
			})

			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta

				yield* processNativeToolCallsFromDelta(delta, getActiveToolUseStyle(this.options)) // kilocode_change

				if (delta?.content) {
					for (const processedChunk of matcher.update(delta.content)) {
						yield processedChunk
					}
				}

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}

			// Process any remaining content
			for (const processedChunk of matcher.final()) {
				yield processedChunk
			}
		} else {
			yield* super.createMessage(
				systemPrompt,
				messages,
				metadata, // kilocode_change
			)
		}
	}

	override getModel() {
		const model = super.getModel()
		const isDeepSeekR1 = model.id.includes("DeepSeek-R1")
		return {
			...model,
			info: {
				...model.info,
				temperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : this.defaultTemperature,
			},
		}
	}
}
