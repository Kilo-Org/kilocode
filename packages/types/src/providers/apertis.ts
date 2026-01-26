// kilocode_change - new file
import type { ModelInfo } from "../model.js"

export const APERTIS_DEFAULT_BASE_URL = "https://api.apertis.ai"

export const apertisDefaultModelId = "claude-sonnet-4-20250514"

export const apertisDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	supportsNativeTools: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	description: "Claude Sonnet 4 via Apertis - balanced performance and cost",
}

// Models that support extended thinking (Claude models)
export const APERTIS_THINKING_MODELS = new Set([
	"claude-sonnet-4-20250514",
	"claude-opus-4-5-20251101",
	"claude-3-5-sonnet-20241022",
	"claude-3-opus-20240229",
])

// Models that use Responses API (reasoning models)
export const APERTIS_RESPONSES_API_MODELS = new Set(["o1-preview", "o1-mini", "o1", "o3-mini", "o3"])
