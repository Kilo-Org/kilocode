import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"
import { cometApiModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"

const cometApiModelSchema = z.object({
	id: z.string(),
	object: z.string().optional(), // "model"
	created: z.number().optional(),
	owned_by: z.string().optional(),
	// Legacy fields that might not exist
	name: z.string().optional(),
	description: z.string().optional(),
	context_length: z.number().optional(),
	max_tokens: z.number().optional(),
	architecture: z
		.object({
			modality: z.string().nullish(),
			tokenizer: z.string().nullish(),
		})
		.optional(),
	pricing: z
		.object({
			prompt: z.string().nullish(),
			completion: z.string().nullish(),
		})
		.optional(),
})

const cometApiModelsResponseSchema = z.object({
	data: z.array(cometApiModelSchema),
	success: z.boolean().optional(),
})

/**
 * Check if a model is suitable for text generation (not image generation)
 */
// Filter function to exclude non-text generation models
function isTextGenerationModel(modelId: string): boolean {
	const id = modelId.toLowerCase()

	// Filter out image generation models
	const imageGenPatterns = [
		"dall-e",
		"dalle",
		"midjourney",
		"stable-diffusion",
		"sd-",
		"flux-",
		"playground-v",
		"ideogram",
		"recraft",
		"black-forest-labs",
	]

	// Filter out TTS (Text-to-Speech), MidJourney, Video generation, Audio generation models
	const prefixPatterns = ["tts", "mj_", "veo", "runway", "suno", "kling_"]

	// Check if model starts with filtered prefixes
	const hasFilteredPrefix = prefixPatterns.some((prefix) => id.startsWith(prefix))

	// Check if model contains filtered patterns
	const hasFilteredPattern = imageGenPatterns.some((pattern) => id.includes(pattern))

	return !hasFilteredPrefix && !hasFilteredPattern
}

export async function getCometAPIModels(options?: ApiHandlerOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.cometApiBaseUrl || "https://api.cometapi.com/v1"
	const apiKey = options?.cometApiKey

	// If no API key provided, return static models as fallback
	if (!apiKey) {
		console.warn("CometAPI: No API key provided, using static model definitions")
		return cometApiModels
	}

	try {

		// Fetch models directly

		const response = await fetch(`${baseURL}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			signal: AbortSignal.timeout(10000), // 10 second timeout
		})

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}

		const data = await response.json()

		const parseResult = cometApiModelsResponseSchema.safeParse(data)

		if (!parseResult.success) {
			console.error("CometAPI models response is invalid", parseResult.error.format())

			console.warn("CometAPI: Falling back to static model definitions")
			return cometApiModels
		}

		// Parse API response and convert to ModelInfo format

		for (const model of parseResult.data.data) {

			// Filter out image generation models - we only want text generation models
			if (!isTextGenerationModel(model.id)) {
				continue
			}

			// Since CometAPI only returns basic model info (id, object, created, owned_by),
			// we need to provide reasonable defaults based on model name patterns
			const modelId = model.id.toLowerCase()

			// Smart defaults based on model patterns
			let contextWindow = 8192
			let supportsImages = false
			let description = model.id

			// Claude models
			if (modelId.includes("claude")) {
				if (modelId.includes("3-5-sonnet")) {
					contextWindow = 200000
					supportsImages = true
					description = "Claude 3.5 Sonnet - Advanced reasoning and code generation"
				} else if (modelId.includes("3-5-haiku")) {
					contextWindow = 200000
					supportsImages = true
					description = "Claude 3.5 Haiku - Fast and efficient responses"
				} else if (modelId.includes("claude-3")) {
					contextWindow = 200000
					supportsImages = true
					description = "Claude 3 series - Advanced AI assistant"
				}
			}
			// GPT models
			else if (modelId.includes("gpt-4")) {
				contextWindow = 128000
				supportsImages = modelId.includes("vision") || modelId.includes("4o")
				description = modelId.includes("4o")
					? "GPT-4o - Optimized for speed and cost"
					: "GPT-4 - Advanced language model"
			} else if (modelId.includes("gpt-3.5")) {
				contextWindow = 16385
				description = "GPT-3.5 Turbo - Fast and capable"
			}
			// Qwen models
			else if (modelId.includes("qwen")) {
				if (modelId.includes("72b") || modelId.includes("110b")) {
					contextWindow = 32768
				} else if (modelId.includes("32b")) {
					contextWindow = 32768
				} else {
					contextWindow = 32768
				}
				description = `Qwen ${modelId.includes("coder") ? "Coder" : ""} - Alibaba's language model`
			}
			// Abab models (Minimax)
			else if (modelId.includes("abab")) {
				contextWindow = 245760 // ~240k tokens
				description = "Minimax Abab - Chinese-optimized language model"
			}
			// Gemini models
			else if (modelId.includes("gemini")) {
				if (modelId.includes("pro")) {
					contextWindow = 2097152 // 2M tokens
					supportsImages = true
				} else {
					contextWindow = 1048576 // 1M tokens
					supportsImages = true
				}
				description = "Google Gemini - Multimodal AI model"
			}
			// Llama models
			else if (modelId.includes("llama")) {
				contextWindow = modelId.includes("3.1") ? 131072 : 8192
				description = "Meta Llama - Open source language model"
			}
			// Mistral models
			else if (modelId.includes("mistral")) {
				contextWindow = 32768
				description = "Mistral AI - European AI excellence"
			}
			// Yi models
			else if (modelId.includes("yi-")) {
				contextWindow = 200000
				description = "01.AI Yi - Bilingual AI model"
			}
			// DeepSeek models
			else if (modelId.includes("deepseek")) {
				contextWindow = 64000
				description = "DeepSeek - Code and reasoning specialist"
			}

			models[model.id] = {
				contextWindow,
				supportsImages,
				supportsPromptCache: false, // CometAPI doesn't support prompt caching yet
				inputPrice: parseApiPrice(model.pricing?.prompt), // Will be undefined if not provided
				outputPrice: parseApiPrice(model.pricing?.completion), // Will be undefined if not provided
				description,
			}
		}

		// Merge with static models to ensure all predefined models are available
		// API models take precedence over static ones if they have the same ID
		const mergedModels = { ...cometApiModels, ...models }

		console.log(`CometAPI: Successfully loaded ${Object.keys(models).length} models from API`)
		return mergedModels
	} catch (error) {
		console.error(`Error fetching CometAPI models:`, error)
		console.warn("CometAPI: Falling back to static model definitions")
		return cometApiModels
	}
}
