import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	internationalZAiModels,
	mainlandZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	type ModelInfo,
	ZAI_DEFAULT_TEMPERATURE,
	zaiApiLineConfigs,
} from "@roo-code/types"

import { type ApiHandlerOptions, getModelMaxOutputTokens, shouldUseReasoningEffort } from "../../shared/api"
import { convertToZAiFormat } from "../transform/zai-format"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

// Custom interface for Z.ai params to support thinking mode
type ZAiChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking?: { type: "enabled" | "disabled" }
}

export class ZAiHandler extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: ApiHandlerOptions) {
		const isChina = zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].isChina
		const models = (isChina ? mainlandZAiModels : internationalZAiModels) as unknown as Record<string, ModelInfo>
		const defaultModelId = (isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId) as string

		super({
			...options,
			providerName: "Z.ai",
			baseURL: zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].baseUrl,
			apiKey: options.zaiApiKey ?? "not-provided",
			defaultProviderModelId: defaultModelId,
			providerModels: models,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}

	/**
	 * Override createStream to handle GLM-4.7's thinking mode.
	 * GLM-4.7 has thinking enabled by default in the API, so we need to
	 * explicitly send { type: "disabled" } when the user turns off reasoning.
	 */
	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: modelId, info } = this.getModel()

		// Check if this is a GLM-4.7 model with thinking support
		const isThinkingModel = modelId === "glm-4.7" && Array.isArray(info.supportsReasoningEffort)

		if (isThinkingModel) {
			// For GLM-4.7, thinking is ON by default in the API.
			// We need to explicitly disable it when reasoning is off.
			const useReasoning = shouldUseReasoningEffort({ model: info, settings: this.options })

			// Create the stream with our custom thinking parameter
			return this.createStreamWithThinking(systemPrompt, messages, metadata, useReasoning)
		}

		// For non-thinking models, use the default behavior
		return super.createStream(systemPrompt, messages, metadata, requestOptions)
	}

	/**
	 * Creates a stream with explicit thinking control for GLM-4.7
	 */
	private createStreamWithThinking(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		useReasoning?: boolean,
	) {
		const { id: model, info } = this.getModel()

		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const temperature = this.options.modelTemperature ?? this.defaultTemperature

		// Use Z.ai format to preserve reasoning_content and merge post-tool text into tool messages
		const convertedMessages = convertToZAiFormat(messages, { mergeToolResultText: true })

		const params: ZAiChatCompletionParams = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertedMessages],
			stream: true,
			stream_options: { include_usage: true },
			// For GLM-4.7: thinking is ON by default, so we explicitly disable when needed
			thinking: useReasoning ? { type: "enabled" } : { type: "disabled" },
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			...(metadata?.toolProtocol === "native" && {
				parallel_tool_calls: metadata.parallelToolCalls ?? false,
			}),
		}

		return this.client.chat.completions.create(params)
	}
}
