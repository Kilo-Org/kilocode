import { moonshotModels, moonshotDefaultModelId, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"

// kilocode_change start
const STRICT_KIMI_TEMPERATURES = {
	"kimi-k2.5": {
		thinkingEnabled: 1.0,
		thinkingDisabled: moonshotModels["kimi-k2.5"].defaultTemperature ?? 0.6,
	},
	"kimi-for-coding": {
		thinkingEnabled: 1.0,
		thinkingDisabled: moonshotModels["kimi-for-coding"].defaultTemperature ?? 0.6,
	},
} as const

type StrictKimiModelId = keyof typeof STRICT_KIMI_TEMPERATURES
const STRICT_KIMI_MODELS = new Set(Object.keys(STRICT_KIMI_TEMPERATURES))
// kilocode_change end

export class MoonshotHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? moonshotDefaultModelId
		const modelInfo =
			moonshotModels[modelId as keyof typeof moonshotModels] || moonshotModels[moonshotDefaultModelId]

		const config: OpenAICompatibleConfig = {
			providerName: "moonshot",
			baseURL: options.moonshotBaseUrl ?? "https://api.moonshot.ai/v1",
			apiKey: options.moonshotApiKey ?? "not-provided",
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? moonshotDefaultModelId
		const info = moonshotModels[id as keyof typeof moonshotModels] || moonshotModels[moonshotDefaultModelId]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	/**
	 * Override to handle Moonshot's usage metrics, including caching.
	 * Moonshot returns cached_tokens in a different location than standard OpenAI.
	 */
	protected override processUsageMetrics(usage: {
		inputTokens?: number
		outputTokens?: number
		details?: {
			cachedInputTokens?: number
			reasoningTokens?: number
		}
		raw?: Record<string, unknown>
	}): ApiStreamUsageChunk {
		// Moonshot uses cached_tokens at the top level of raw usage data
		const rawUsage = usage.raw as { cached_tokens?: number } | undefined

		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheWriteTokens: 0,
			cacheReadTokens: rawUsage?.cached_tokens ?? usage.details?.cachedInputTokens,
		}
	}

	/**
	 * Override to always include max_tokens for Moonshot (not max_completion_tokens).
	 * Moonshot requires max_tokens parameter to be sent.
	 */
	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.config.modelInfo
		// Moonshot always requires max_tokens
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}

	// kilocode_change start
	private isStrictKimiModel(modelId: string): boolean {
		return STRICT_KIMI_MODELS.has(modelId)
	}

	private getStrictKimiTemperatureConfig(modelId: string) {
		if (!this.isStrictKimiModel(modelId)) {
			return undefined
		}

		return STRICT_KIMI_TEMPERATURES[modelId as StrictKimiModelId]
	}

	private isStrictKimiThinkingEnabled(): boolean {
		return this.options.enableReasoningEffort !== false
	}

	protected override getRequestTemperature(model: { id: string; temperature?: number }): number | undefined {
		const strictTemperatureConfig = this.getStrictKimiTemperatureConfig(model.id)
		if (strictTemperatureConfig) {
			return this.isStrictKimiThinkingEnabled()
				? strictTemperatureConfig.thinkingEnabled
				: strictTemperatureConfig.thinkingDisabled
		}

		return super.getRequestTemperature(model)
	}

	protected override getProviderOptions(
		model: { id: string; info: ModelInfo },
		metadata?: Parameters<OpenAICompatibleHandler["getProviderOptions"]>[1],
	): ReturnType<OpenAICompatibleHandler["getProviderOptions"]> {
		const inheritedProviderOptions = super.getProviderOptions(model, metadata)
		const existingMoonshotOptions =
			inheritedProviderOptions?.moonshot &&
			typeof inheritedProviderOptions.moonshot === "object" &&
			!Array.isArray(inheritedProviderOptions.moonshot)
				? inheritedProviderOptions.moonshot
				: {}
		const moonshotOptions = {
			...existingMoonshotOptions,
			...(metadata?.taskId ? { prompt_cache_key: metadata.taskId } : {}),
		}

		if (!this.isStrictKimiModel(model.id)) {
			if (Object.keys(moonshotOptions).length === 0) {
				return inheritedProviderOptions
			}

			return {
				...inheritedProviderOptions,
				moonshot: moonshotOptions,
			}
		}

		const thinking = {
			type: (this.isStrictKimiThinkingEnabled() ? "enabled" : "disabled") as "enabled" | "disabled",
		}

		return {
			...inheritedProviderOptions,
			moonshot: {
				...moonshotOptions,
				thinking,
			},
		}
	}
	// kilocode_change end
}
