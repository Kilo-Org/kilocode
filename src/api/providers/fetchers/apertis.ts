// kilocode_change - new file
import { APERTIS_DEFAULT_BASE_URL, APERTIS_THINKING_MODELS, APERTIS_RESPONSES_API_MODELS } from "@roo-code/types"
import type { ModelRecord } from "../../../shared/api"

interface ApertisModelsResponse {
	data: string[]
}

/**
 * Infer context window based on model ID patterns
 */
function getContextWindow(modelId: string): number {
	if (modelId.includes("claude-3")) return 200_000
	if (modelId.includes("claude-sonnet-4") || modelId.includes("claude-opus-4")) return 200_000
	if (modelId.includes("gpt-4o")) return 128_000
	if (modelId.includes("gpt-4-turbo")) return 128_000
	if (modelId.includes("gpt-4")) return 8_192
	if (modelId.includes("gpt-3.5")) return 16_385
	if (modelId.includes("gemini-2")) return 1_000_000
	if (modelId.includes("gemini-1.5")) return 1_000_000
	if (modelId.includes("o1") || modelId.includes("o3")) return 200_000
	if (modelId.includes("deepseek")) return 64_000
	return 128_000 // Default
}

/**
 * Check if model supports vision/images
 */
function supportsVision(modelId: string): boolean {
	const visionPatterns = [
		"gpt-4o",
		"gpt-4-turbo",
		"gpt-4-vision",
		"claude-3",
		"claude-sonnet-4",
		"claude-opus-4",
		"gemini",
		"gpt-image",
	]
	return visionPatterns.some((p) => modelId.includes(p))
}

/**
 * Fetch available models from Apertis API
 */
export async function getApertisModels(options?: { apiKey?: string; baseUrl?: string }): Promise<ModelRecord> {
	const baseUrl = options?.baseUrl || APERTIS_DEFAULT_BASE_URL

	try {
		// Use public endpoint (no auth required)
		const response = await fetch(`${baseUrl}/api/models`)

		if (!response.ok) {
			console.error(`[Apertis] Failed to fetch models: ${response.status}`)
			return {}
		}

		const data: ApertisModelsResponse = await response.json()

		if (!data.data || !Array.isArray(data.data)) {
			console.error("[Apertis] Invalid response format")
			return {}
		}

		const models: ModelRecord = {}

		for (const modelId of data.data) {
			models[modelId] = {
				contextWindow: getContextWindow(modelId),
				supportsPromptCache: modelId.startsWith("claude-"),
				supportsImages: supportsVision(modelId),
				supportsReasoningBudget: APERTIS_THINKING_MODELS.has(modelId),
				supportsReasoningEffort: APERTIS_RESPONSES_API_MODELS.has(modelId),
			}
		}

		return models
	} catch (error) {
		console.error("[Apertis] Error fetching models:", error)
		return {}
	}
}
