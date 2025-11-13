import axios from "axios"
import { z } from "zod"

import { type ModelInfo, chutesModels } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

// Chutes models endpoint follows OpenAI /models shape with additional fields
const ChutesModelSchema = z.object({
	id: z.string(),
	object: z.literal("model").optional(),
	owned_by: z.string().optional(),
	created: z.number().optional(),
	context_length: z.number(),
	max_model_len: z.number(),
	input_modalities: z.array(z.string()),
})

const ChutesModelsResponseSchema = z.object({ data: z.array(ChutesModelSchema) })

export async function getChutesModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }
	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

	const url = "https://llm.chutes.ai/v1/models"

	// Start with hardcoded models as the base
	const models: Record<string, ModelInfo> = { ...chutesModels }

	try {
		const response = await axios.get(url, { headers })
		const parsed = ChutesModelsResponseSchema.safeParse(response.data)
		const data = parsed.success ? parsed.data.data : response.data?.data || []

		for (const m of data as Array<z.infer<typeof ChutesModelSchema>>) {
			// Extract from API response (all fields are required)
			const contextWindow = m.context_length
			const maxTokens = m.max_model_len
			const supportsImages = m.input_modalities.includes("image")

			const info: ModelInfo = {
				maxTokens,
				contextWindow,
				supportsImages,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: `Chutes AI model: ${m.id}`,
			}

			// Union: dynamic models override hardcoded ones if they have the same ID
			models[m.id] = info
		}
	} catch (error) {
		console.error(`Error fetching Chutes models: ${error instanceof Error ? error.message : String(error)}`)
		// On error, still return hardcoded models
	}

	return models
}
