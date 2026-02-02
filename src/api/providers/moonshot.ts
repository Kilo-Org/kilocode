import OpenAI from "openai"
import { moonshotModels, moonshotDefaultModelId, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAiHandler } from "./openai"

export class MoonshotHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.moonshotApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? moonshotDefaultModelId,
			openAiBaseUrl: options.moonshotBaseUrl ?? "https://api.moonshot.ai/v1",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? moonshotDefaultModelId
		const info = moonshotModels[id as keyof typeof moonshotModels] || moonshotModels[moonshotDefaultModelId]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	// Override to handle Moonshot's usage metrics, including caching.
	protected override processUsageMetrics(usage: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: 0,
			cacheReadTokens: usage?.cached_tokens,
		}
	}

	// Override to add Kimi-specific thinking parameter format
	protected override addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Moonshot uses max_tokens instead of max_completion_tokens
		requestOptions.max_tokens = this.options.modelMaxTokens || modelInfo.maxTokens

		// For Kimi models with reasoning budget, use { type: "enabled" } instead of { max_tokens: ... }
		const { info: model } = this.getModel()
		if (this.options.enableReasoningEffort && (model as any).supportsReasoningBudget) {
			// Remove the OpenAI-style reasoning parameter and use Kimi's thinking parameter
			delete (requestOptions as any).reasoning
			;(requestOptions as any).thinking = { type: "enabled" }
		}
	}
}
