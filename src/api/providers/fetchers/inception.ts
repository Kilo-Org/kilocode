// kilocode_change - file added

import axios from "axios"
import { object, z } from "zod"

import { type ModelInfo } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

// Inception models endpoint follows OpenAI /models shape wiht an added metadata object

const InceptionModelPricingSchema = z.object({
	prompt: z.number().describe("Pricing per 1 input token"),
	completion: z.number().describe("Pricing per 1 output token"),
	image: z.number().describe("Pricing per 1 image"),
	request: z.number().describe("Pricing per 1 request"),
	input_cache_reads: z.number().describe("Pricing per 1 token for cache reads"),
	input_cache_writes: z.number().describe("Pricing per 1 token for cache writes"),
})

const InceptionModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	created: z.number(),
	input_modalities: z.string().array(),
	output_modalities: z.string().array(),
	context_length: z.number().int(),
	max_output_length: z.number().int(),
	pricing: InceptionModelPricingSchema,
	suported_sampling_parameters: z.string().array(),
	supported_features: z.string().array(),
	supports_prefix_caching: z.boolean().default(false),

	description: z.string().optional(),
})

const InceptionModelsResponseSchema = z.object({ data: z.array(InceptionModelSchema) })

export async function getInceptionModels(
	apiKey?: string,
	baseUrl: string = "https://api.inceptionlabs.ai/v1/",
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const url = `${baseUrl.replace(/\/$/, "")}/models`
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }

	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

	const response = await axios.get(url, { headers })

	const parsed = InceptionModelsResponseSchema.safeParse(response.data)
	const data = parsed.success ? parsed.data.data : response.data?.data || []

	for (const m of data as Array<z.infer<typeof InceptionModelSchema>>) {
		const info: ModelInfo = {
			contextWindow: m.context_length,
			maxTokens: m.max_output_length,
			inputPrice: m.pricing.prompt,
			outputPrice: m.pricing.completion,
			description: m.description,
			supportsPromptCache: m.supports_prefix_caching,
			supportsImages: false,
			cacheReadsPrice: m.pricing.input_cache_reads,
			cacheWritesPrice: m.pricing.input_cache_writes,
			supportsNativeTools: true,
			defaultToolProtocol: "native",
		}
		models[m.id] = info
	}

	return models
}
