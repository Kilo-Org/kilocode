import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"
import type { ApiHandlerOptions } from "../../shared/api"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import type { SingleCompletionHandler } from "../index"

// Morph model configurations
const MORPH_MODELS = {
	"morph-v3-fast": {
		id: "morph-v3-fast",
		name: "Morph v3 Fast",
		description: "Ultra-fast semantic apply model with 96% accuracy",
		maxTokens: 32000,
		inputPrice: 0.0015,
		outputPrice: 0.006,
		supportsVision: false,
		supportsPromptCache: false,
		contextWindow: 32000,
		supportsSemanticApply: true,
	},
	"morph-v3-large": {
		id: "morph-v3-large", 
		name: "Morph v3 Large",
		description: "High-accuracy semantic apply model with 98% accuracy",
		maxTokens: 32000,
		inputPrice: 0.003,
		outputPrice: 0.012,
		supportsVision: false,
		supportsPromptCache: false,
		contextWindow: 32000,
		supportsSemanticApply: true,
	},
} as const satisfies Record<string, ModelInfo>

// OpenRouter model mappings
const OPENROUTER_MORPH_MODELS = {
	"morph/morph-v3-fast": MORPH_MODELS["morph-v3-fast"],
	"morph/morph-v3-large": MORPH_MODELS["morph-v3-large"],
} as const

type MorphModelName = keyof typeof MORPH_MODELS
type OpenRouterMorphModelName = keyof typeof OPENROUTER_MORPH_MODELS

export interface MorphFastApplyOptions extends ApiHandlerOptions {
	morphApiKey?: string
	morphBaseUrl?: string
	morphModel?: MorphModelName | OpenRouterMorphModelName
	provider?: 'morph-direct' | 'openrouter'
	timeout?: number
	maxRetries?: number
}

export class MorphFastApplyProvider extends BaseOpenAiCompatibleProvider<MorphModelName> implements SingleCompletionHandler {
	private morphOptions: MorphFastApplyOptions
	private provider: 'morph-direct' | 'openrouter'

	constructor(options: MorphFastApplyOptions) {
		const provider = options.provider || 'openrouter'
		const baseURL = provider === 'morph-direct' 
			? (options.morphBaseUrl || 'https://api.morphllm.com/v1')
			: 'https://openrouter.ai/api/v1'
		
		const apiKey = provider === 'morph-direct' 
			? options.morphApiKey || options.apiKey
			: options.openRouterApiKey || options.apiKey

		if (!apiKey) {
			throw new Error(`API key is required for ${provider}`)
		}

		super({
			...options,
			apiKey,
			providerName: provider === 'morph-direct' ? 'Morph' : 'OpenRouter-Morph',
			baseURL,
			defaultProviderModelId: 'morph-v3-fast',
			providerModels: MORPH_MODELS,
			defaultTemperature: 0.1,
		})

		this.morphOptions = options
		this.provider = provider
	}

	/**
	 * Apply semantic edit using Morph's enterprise format
	 * @param instruction One sentence description to disambiguate uncertainty
	 * @param originalCode Original code to be modified
	 * @param updateSnippet Specific changes using truncation markers
	 * @returns Promise<string> The merged code
	 */
	async applySemanticEdit(
		instruction: string,
		originalCode: string,
		updateSnippet: string
	): Promise<string> {
		const { id: baseModelId } = this.getModel()
		const modelName = this.provider === 'openrouter' 
			? `morph/${baseModelId}` 
			: baseModelId

		// Format according to Morph Enterprise API documentation
		const content = `<instruction>${instruction}</instruction>\n<code>${originalCode}</code>\n<update>${updateSnippet}</update>`

		const params: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelName,
			messages: [
				{
					role: "user",
					content
				}
			],
			max_tokens: 32000,
			temperature: 0,
			stream: false,
		}

		try {
			const response = await this.client.chat.completions.create(params)
			
			if ('error' in response) {
				const error = response.error as { message?: string; code?: number }
				throw new Error(`${this.providerName} API Error ${error?.code}: ${error?.message}`)
			}

			const completion = response as OpenAI.Chat.ChatCompletion
			const content = completion.choices[0]?.message?.content

			if (!content) {
				throw new Error(`${this.providerName} returned empty response`)
			}

			return content
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} semantic edit failed: ${error.message}`)
			}
			throw error
		}
	}

	override getModel() {
		const requestedModel = this.morphOptions.morphModel || 'morph-v3-fast'
		
		// Always return the base model name for consistency with BaseOpenAiCompatibleProvider
		let baseModelName: MorphModelName
		if (requestedModel.startsWith('morph/')) {
			// Convert OpenRouter model name to base model name
			baseModelName = requestedModel === 'morph/morph-v3-fast' ? 'morph-v3-fast' : 'morph-v3-large'
		} else {
			baseModelName = requestedModel as MorphModelName
		}
		
		return { id: baseModelName, info: MORPH_MODELS[baseModelName] }
	}

	/**
	 * Check if this provider supports semantic apply operations
	 */
	supportsSemanticApply(): boolean {
		return true
	}

	/**
	 * Get the provider type
	 */
	getProviderType(): 'morph-direct' | 'openrouter' {
		return this.provider
	}
} 