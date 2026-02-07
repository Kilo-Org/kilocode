import axios from "axios"
import { z } from "zod"

import { type ModelInfo, chutesModels } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

// Chutes models endpoint follows OpenAI /models shape with additional fields.
// All fields are optional to allow graceful handling of incomplete API responses.
const ChutesModelSchema = z.object({
	id: z.string().optional(),
	object: z.literal("model").optional(),
	owned_by: z.string().optional(),
	created: z.number().optional(),
	context_length: z.number().optional(),
	max_model_len: z.number().optional(),
	input_modalities: z.array(z.string()).optional(),
	supported_features: z.array(z.string()).optional(),
})

const ChutesModelsResponseSchema = z.object({ data: z.array(ChutesModelSchema) })

type ChutesModelsResponse = z.infer<typeof ChutesModelsResponseSchema>

export async function getChutesModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	const url = "https://llm.chutes.ai/v1/models"

	// Start with hardcoded models as the base.
	const models: Record<string, ModelInfo> = { ...chutesModels }

	try {
		const response = await axios.get<ChutesModelsResponse>(url, { headers })
		const result = ChutesModelsResponseSchema.safeParse(response.data)

		// Graceful fallback: use parsed data if valid, otherwise fall back to raw response data.
		// This mirrors the OpenRouter pattern for handling API responses with some invalid items.
		const data = result.success ? result.data.data : response.data?.data

		if (!result.success) {
			console.error(`Error parsing Chutes models response: ${JSON.stringify(result.error.format(), null, 2)}`)
		}

		if (!data || !Array.isArray(data)) {
			console.error("Chutes models response missing data array")
			return models
		}

		for (const m of data) {
			// Skip items missing required fields (e.g., empty objects from API)
			if (!m || typeof m.id !== "string" || !m.id) {
				continue
			}

			const contextWindow =
				typeof m.context_length === "number" && Number.isFinite(m.context_length) ? m.context_length : undefined
			const maxModelLen =
				typeof m.max_model_len === "number" && Number.isFinite(m.max_model_len) ? m.max_model_len : undefined

			// Skip models without valid context window information
			if (!contextWindow) {
				continue
			}

			const info: ModelInfo = {
				maxTokens: maxModelLen ?? Math.ceil(contextWindow * 0.2),
				contextWindow,
				supportsImages: (m.input_modalities || []).includes("image"),
				supportsPromptCache: false,
				supportsNativeTools: (m.supported_features || []).includes("tools"),
				inputPrice: 0,
				outputPrice: 0,
				description: `Chutes AI model: ${m.id}`,
			}

			// Union: dynamic models override hardcoded ones if they have the same ID.
			models[m.id] = info
		}
	} catch (error) {
		console.error(`Error fetching Chutes models: ${error instanceof Error ? error.message : String(error)}`)
		// On error, still return hardcoded models.
	}

	return models
}
