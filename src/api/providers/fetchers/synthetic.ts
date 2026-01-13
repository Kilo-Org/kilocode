// kilocode_change - file added
import axios from "axios"
import { z } from "zod"

import { isModelParameter, type ModelInfo } from "@roo-code/types"

// Synthetic /openai/v1/models item schema (based on models.json)
const syntheticModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	provider: z.string().optional(),
	always_on: z.boolean().optional(),
	context_length: z.number().optional(),
	max_output_length: z.number().optional(),
	pricing: z
		.object({
			prompt: z.string().optional(),
			completion: z.string().optional(),
			image: z.string().optional(),
			request: z.string().optional(),
			input_cache_reads: z.string().optional(),
			input_cache_writes: z.string().optional(),
		})
		.optional(),
	input_modalities: z.array(z.string()).optional(),
	output_modalities: z.array(z.string()).optional(),
	quantization: z.string().optional().nullable(),
	supported_sampling_parameters: z.array(z.string()).optional().nullable(),
	supported_features: z.array(z.string()).optional().nullable(),
})

const syntheticModelsResponseSchema = z.object({
	data: z.array(syntheticModelSchema),
})

type SyntheticModelsResponse = z.infer<typeof syntheticModelsResponseSchema>

type SyntheticModel = z.infer<typeof syntheticModelSchema>

function parsePrice(value?: string): number | undefined {
	if (!value) return undefined
	// Values look like "$0.00000055"; strip non-numeric/decimal and parse
	const match = value.match(/[0-9.]+/)
	if (!match) return undefined
	const num = Number(match[0])
	return Number.isFinite(num) ? num * 1_000_000 : undefined
}

function parseSyntheticModel(model: SyntheticModel): ModelInfo {
	const contextWindow = model.context_length ?? 131_072
	const maxOutput = model.max_output_length ?? Math.min(contextWindow, 65_536)

	const inputPrice = parsePrice(model.pricing?.prompt)
	const outputPrice = parsePrice(model.pricing?.completion)
	const cacheReadsPrice = parsePrice(model.pricing?.input_cache_reads)
	const cacheWritesPrice = parsePrice(model.pricing?.input_cache_writes)

	const supportsImages = (model.input_modalities || []).includes("image")
	const supportsPromptCache = Boolean(model.pricing?.input_cache_reads || model.pricing?.input_cache_writes)

	return {
		maxTokens: maxOutput,
		contextWindow,
		supportsImages,
		supportsPromptCache,
		supportsComputerUse: false,
		inputPrice,
		outputPrice,
		cacheReadsPrice,
		cacheWritesPrice,
		description: model.name || model.id,
		// Synthetic may expose reasoning-capable models but API does not mark them distinctly in models.json
		supportsReasoningEffort: false,
		supportsReasoningBudget: (model.supported_features || []).includes("reasoning"),
		supportedParameters: (model.supported_sampling_parameters || []).filter(isModelParameter),
		supportsTemperature: (model.supported_sampling_parameters || []).includes("temperature"),
		supportsNativeTools: true,
		defaultToolProtocol: "native",
	}
}

export async function getSyntheticModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`
		}

		const response = await axios.get<SyntheticModelsResponse>("https://api.synthetic.new/openai/v1/models", {
			headers,
			timeout: 10_000,
		})

		const result = syntheticModelsResponseSchema.safeParse(response.data)
		if (!result.success) {
			console.error("Synthetic models response validation failed:", result.error.format())
			throw new Error(
				`Synthetic API returned invalid response format. Validation errors: ${JSON.stringify(result.error.format())}`,
			)
		}

		for (const model of result.data.data) {
			models[model.id] = parseSyntheticModel(model)
		}

		return models
	} catch (error) {
		console.error("Error fetching Synthetic models:", error)

		if (axios.isAxiosError(error)) {
			if (error.code === "ECONNABORTED") {
				const timeoutError = new Error("Failed to fetch Synthetic models: Request timeout")
				;(timeoutError as any).cause = error
				throw timeoutError
			} else if (error.response) {
				const responseError = new Error(
					`Failed to fetch Synthetic models: ${error.response.status} ${error.response.statusText}`,
				)
				;(responseError as any).cause = error
				throw responseError
			} else if (error.request) {
				const requestError = new Error("Failed to fetch Synthetic models: No response")
				;(requestError as any).cause = error
				throw requestError
			}
		}

		const fetchError = new Error(
			`Failed to fetch Synthetic models: ${error instanceof Error ? error.message : "Unknown error"}`,
		)
		;(fetchError as any).cause = error
		throw fetchError
	}
}
