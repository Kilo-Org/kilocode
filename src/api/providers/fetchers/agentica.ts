// kilocode_change - new file
import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

// Agentica models endpoint schema based on the API response format
const AgenticaModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	category: z.enum(["free", "paid_free", "premium"]).optional(),
	description: z.string().optional(),
	provider: z.string().optional(),
	context_window: z.number().optional(),
	max_tokens: z.number().optional(),
	supports_images: z.boolean().optional(),
	pricing: z
		.object({
			prompt_per_token_usd: z.number().optional(),
			completion_per_token_usd: z.number().optional(),
		})
		.optional(),
})

const AgenticaModelsResponseSchema = z.object({ data: z.array(AgenticaModelSchema) })

type AgenticaModelsResponse = z.infer<typeof AgenticaModelsResponseSchema>

// Fallback models if API is unavailable or unauthenticated
const FALLBACK_MODELS: Record<string, ModelInfo> = {
	// Free Models
	"kimi-k2": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "Moonshot AI Kimi K2 model",
	},
	"deca-2.5-pro-low": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "2.5 pro low",
	},
	"minimax-m2": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "Minimax M2 model",
	},
	"deepseek-v3.1-terminus": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "DeepSeek V3.1 Terminus",
	},
	"qwen3-coder": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "Qwen 3 Coder 480B",
	},
	"gpt-oss-120b": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "GPT OSS 120B",
	},
	"deca-coder-flash": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "Deca Coder Flash (routes via classification)",
	},
	"gemini-3-flash": {
		maxTokens: 8192,
		contextWindow: 1000000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Gemini 3 Flash",
	},
	// Paid-Free Models (no credit cost, paid plan required)
	"glm-4.6": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "GLM 4.6 (paid plans only, no credit cost)",
	},
	"kimi-k2-thinking": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		description: "Kimi K2 Thinking (paid plans only, no credit cost)",
	},
	// Premium Models (costs Agentica daily credits)
	"claude-4.5-sonnet": {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 15,
		description: "Claude 4.5 Sonnet",
	},
	"claude-4.5-opus": {
		maxTokens: 4096,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15,
		outputPrice: 75,
		description: "Claude 4.5 Opus",
	},
	"gpt-5.2": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5,
		outputPrice: 15,
		description: "GPT-5.2",
	},
	"gpt-5.1-codex": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
		description: "GPT-5.1 Codex",
	},
	"gpt-5.1-codex-mini": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 6,
		description: "GPT-5.1 Codex Mini",
	},
	"gemini-3-pro": {
		maxTokens: 8192,
		contextWindow: 1000000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 6,
		description: "Gemini 3 Pro",
	},
	"gemini-2.5-flash": {
		maxTokens: 8192,
		contextWindow: 1000000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.075,
		outputPrice: 0.3,
		description: "Gemini 2.5 Flash",
	},
	"grok-4": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
		description: "Grok 4",
	},
	"grok-4.1-fast": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 12,
		description: "Grok 4.1 Fast",
	},
	"grok-code-fast-1": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 12,
		description: "Grok Code Fast 1",
	},
	"deca-2.5-pro-high": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
		description: "2.5 pro high",
	},
	"deca-2.5-mini": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 3,
		description: "2.5 mini premium model (routes via classification)",
	},
}

export async function getAgenticaModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	const url = "https://api.genlabs.dev/agentica/v1/models"
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get<AgenticaModelsResponse>(url, { headers })
		const result = AgenticaModelsResponseSchema.safeParse(response.data)

		const data = result.success ? result.data.data : response.data?.data

		if (!result.success) {
			console.error(`Error parsing Agentica models response: ${JSON.stringify(result.error.format(), null, 2)}`)
		}

		if (!data || !Array.isArray(data)) {
			console.error("Agentica models response missing data array")
			return models
		}

		for (const m of data) {
			if (!m || typeof m.id !== "string" || !m.id) {
				continue
			}

			const contextWindow = m.context_window ?? 128000
			const isPremium = m.category === "premium"

			const info: ModelInfo & { name?: string; category?: string; provider?: string } = {
				maxTokens: m.max_tokens ?? Math.ceil(contextWindow * 0.2),
				contextWindow,
				supportsImages: m.supports_images ?? false,
				supportsPromptCache: false,
				// Only include pricing for premium models, convert from per-token to per-million
				inputPrice: isPremium ? (m.pricing?.prompt_per_token_usd ?? 0) * 1_000_000 : undefined,
				outputPrice: isPremium ? (m.pricing?.completion_per_token_usd ?? 0) * 1_000_000 : undefined,
				description: m.description ?? `Agentica model: ${m.id}`,
				// Extra fields for UI display
				name: m.name,
				category: m.category,
				provider: m.provider,
			}

			models[m.id] = info
		}

		// If we got models, return them; otherwise fall back to predefined models
		if (Object.keys(models).length > 0) {
			return models
		}
	} catch (error) {
		console.error(`Error fetching Agentica models: ${error instanceof Error ? error.message : String(error)}`)
	}

	// Return fallback models if API failed, returned empty, or is unavailable
	return FALLBACK_MODELS
}
