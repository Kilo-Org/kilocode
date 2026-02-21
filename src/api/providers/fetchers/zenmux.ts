import { z } from "zod"

import { type ModelInfo, zenmuxDefaultModelInfo } from "@roo-code/types"
import type { ApiHandlerOptions } from "../../../shared/api"
import { DEFAULT_HEADERS } from "../constants"

/**
 * ZenMuxModel
 */
const zenMuxModelSchema = z.object({
	id: z.string(),
	object: z.string(),
	created: z.number(),
	owned_by: z.string(),
	display_name: z.string().optional(),
	context_length: z.number().optional(),
	input_modalities: z.array(z.string()).optional(),
})

export type ZenMuxModel = z.infer<typeof zenMuxModelSchema>

/**
 * ZenMuxModelsResponse
 */
const zenMuxModelsResponseSchema = z.object({
	data: z.array(zenMuxModelSchema),
	object: z.string(),
})

/**
 * getZenmuxRouterModels
 */
export async function getZenmuxModels(
	options?: ApiHandlerOptions & { headers?: Record<string, string> },
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://zenmux.ai/api/v1"
	try {
		const response = await fetch(`${baseURL}/models`, {
			headers: { ...DEFAULT_HEADERS, ...(options?.headers ?? {}) },
		})
		const json = await response.json()
		const result = zenMuxModelsResponseSchema.safeParse(json)

		if (!result.success) {
			throw new Error("ZenMux models response is invalid: " + JSON.stringify(result.error.format(), undefined, 2))
		}

		const data = result.data.data

		for (const model of data) {
			const { id, owned_by, display_name, context_length, input_modalities } = model
			const contextWindow =
				context_length && context_length > 0 ? context_length : zenmuxDefaultModelInfo.contextWindow

			const modelInfo: ModelInfo = {
				// Keep max tokens conservative and let centralized max-token logic decide runtime reservation.
				maxTokens: 0,
				contextWindow,
				supportsImages: input_modalities?.includes("image") ?? false,
				supportsPromptCache: false,
				// kilocode_change start
				supportsNativeTools: true,
				defaultToolProtocol: "native",
				// kilocode_change end
				inputPrice: 0,
				outputPrice: 0,
				description: `${owned_by || "ZenMux"} model`,
				displayName: display_name || id,
			}

			models[id] = modelInfo
		}

		console.log(`Successfully fetched ${Object.keys(models).length} ZenMux models`)
	} catch (error) {
		console.error(`Error fetching ZenMux models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
		throw error
	}

	return models
}
