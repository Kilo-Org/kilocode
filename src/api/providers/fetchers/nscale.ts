// kilocode_change - new file

import axios from "axios"
import { z } from "zod"

import { type ModelInfo } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

// Nscale models endpoint follows OpenAI /models shape

const NscaleModelSchema = z.object({
	id: z.string(),
	object: z.string().optional(),
	created: z.number().optional(),
	owned_by: z.string().optional(),
})

const NscaleModelsResponseSchema = z.object({ data: z.array(NscaleModelSchema) })

export async function getNscaleModels(
	apiKey?: string,
	baseUrl: string = "https://inference.api.nscale.com/v1",
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const url = `${baseUrl.replace(/\/$/, "")}/models`
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }

	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

	const response = await axios.get(url, { headers })

	const parsed = NscaleModelsResponseSchema.safeParse(response.data)
	const data = parsed.success ? parsed.data.data : response.data?.data || []

	for (const m of data as Array<z.infer<typeof NscaleModelSchema>>) {
		// Nscale API returns minimal model info, so we use sensible defaults
		const info: ModelInfo = {
			contextWindow: 128000, // Default context window
			maxTokens: 8192, // Default max tokens
			supportsPromptCache: false,
			supportsImages: false,
		}
		models[m.id] = info
	}

	return models
}
