import { DEEP_SEEK_DEFAULT_TEMPERATURE, type ChutesModelId, chutesDefaultModelId, chutesModels } from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../shared/api"
import { XmlMatcher } from "../../utils/xml-matcher"
import { convertToR1Format } from "../transform/r1-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

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
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
		const {
			id: model,
			info: { maxTokens: max_tokens },
		} = this.getModel()

		const temperature = this.options.modelTemperature ?? this.getModel().info.temperature

		// Use a more flexible type that includes Chutes-specific parameters
		const params: any = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		}

		// Add optional parameters from Chutes API specification
		if (this.options.chutesSeed !== undefined) {
			params.seed = this.options.chutesSeed
		}
		if (this.options.chutesTopP !== undefined) {
			params.top_p = this.options.chutesTopP
		}
		if (this.options.chutesFrequencyPenalty !== undefined) {
			params.frequency_penalty = this.options.chutesFrequencyPenalty
		}
		if (this.options.chutesPresencePenalty !== undefined) {
			params.presence_penalty = this.options.chutesPresencePenalty
		}
		if (this.options.chutesStop !== undefined) {
			params.stop = this.options.chutesStop
		}
		if (this.options.chutesMinP !== undefined) {
			params.min_p = this.options.chutesMinP
		}
		if (this.options.chutesBestOf !== undefined) {
			params.best_of = this.options.chutesBestOf
		}
		if (this.options.chutesLogprobs !== undefined) {
			params.logprobs = this.options.chutesLogprobs
		}
		if (this.options.chutesIgnoreEos !== undefined) {
			params.ignore_eos = this.options.chutesIgnoreEos
		}
		if (this.options.chutesLogitBias !== undefined) {
			params.logit_bias = this.options.chutesLogitBias
		}
		if (this.options.chutesMinTokens !== undefined) {
			params.min_tokens = this.options.chutesMinTokens
		}
		if (this.options.chutesTopLogprobs !== undefined) {
			params.top_logprobs = this.options.chutesTopLogprobs
		}
		if (this.options.chutesLengthPenalty !== undefined) {
			params.length_penalty = this.options.chutesLengthPenalty
		}
		if (this.options.chutesStopTokenIds !== undefined) {
			params.stop_token_ids = this.options.chutesStopTokenIds
		}
		if (this.options.chutesPromptLogprobs !== undefined) {
			params.prompt_logprobs = this.options.chutesPromptLogprobs
		}
		if (this.options.chutesResponseFormat !== undefined) {
			params.response_format = this.options.chutesResponseFormat
		}
		if (this.options.chutesUseBeamSearch !== undefined) {
			params.use_beam_search = this.options.chutesUseBeamSearch
		}
		if (this.options.chutesRepetitionPenalty !== undefined) {
			params.repetition_penalty = this.options.chutesRepetitionPenalty
		}
		if (this.options.chutesSkipSpecialTokens !== undefined) {
			params.skip_special_tokens = this.options.chutesSkipSpecialTokens
		}
		if (this.options.chutesIncludeStopStrInOutput !== undefined) {
			params.include_stop_str_in_output = this.options.chutesIncludeStopStrInOutput
		}
		if (this.options.chutesSpacesBetweenSpecialTokens !== undefined) {
			params.spaces_between_special_tokens = this.options.chutesSpacesBetweenSpecialTokens
		}

		return params as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		if (model.id.includes("DeepSeek-R1")) {
			const stream = await this.client.chat.completions.create({
				...this.getCompletionParams(systemPrompt, messages),
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
			yield* super.createMessage(systemPrompt, messages)
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
