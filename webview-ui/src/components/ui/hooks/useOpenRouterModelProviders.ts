import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "@roo/cost"

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

const openRouterEndpointsSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: z
			.object({
				modality: z.string().nullish(),
				tokenizer: z.string().nullish(),
			})
			.nullish(),
		endpoints: z.array(
			z.object({
				name: z.string(),
				// kilocode_change start
				provider_name: z.string(),
				tag: z.string().optional(),
				// kilocode_change end
				context_length: z.number(),
				max_completion_tokens: z.number().nullish(),
				pricing: z
					.object({
						prompt: z.union([z.string(), z.number()]).optional(),
						completion: z.union([z.string(), z.number()]).optional(),
						// kilocode_change start
						input_cache_read: z.union([z.string(), z.number()]).optional(),
						input_cache_write: z.union([z.string(), z.number()]).optional(),
						// kilocode_change end
					})
					.optional(),
			}),
		),
	}),
})

type OpenRouterModelProvider = ModelInfo & {
	label: string
}

// kilocode_change: baseUrl, apiKey
async function getOpenRouterProvidersForModel(modelId: string, baseUrl?: string, apiKey?: string) {
	const models: Record<string, OpenRouterModelProvider> = {}

	try {
		// kilocode_change start: baseUrl, apiKey
		const response = await axios.get(
			`${baseUrl?.trim() || "https://openrouter.ai/api/v1"}/models/${modelId}/endpoints`,
			apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
		)
		// kilocode_change end
		const result = openRouterEndpointsSchema.safeParse(response.data)

		if (!result.success) {
			console.error("OpenRouter API response validation failed:", result.error)
			return models
		}

		const { id, description, architecture, endpoints } = result.data.data

		for (const endpoint of endpoints) {
			const providerName = endpoint.tag ?? endpoint.provider_name // kilocode_change
			const inputPrice = parseApiPrice(endpoint.pricing?.prompt)
			const outputPrice = parseApiPrice(endpoint.pricing?.completion)

			// kilocode_change start
			const cacheReadsPrice = parseApiPrice(endpoint.pricing?.input_cache_read)
			const cacheWritesPrice = parseApiPrice(endpoint.pricing?.input_cache_write)
			// kilocode_change end

			const modelInfo: OpenRouterModelProvider = {
				maxTokens: endpoint.max_completion_tokens || endpoint.context_length,
				contextWindow: endpoint.context_length,
				supportsImages: architecture?.modality?.includes("image"),
				// kilocode_change start
				supportsPromptCache: typeof cacheReadsPrice !== "undefined",
				cacheReadsPrice,
				cacheWritesPrice,
				// kilocode_change end
				inputPrice,
				outputPrice,
				description,
				label: providerName,
			}

			// TODO: This is wrong. We need to fetch the model info from
			// OpenRouter instead of hardcoding it here. The endpoints payload
			// doesn't include this unfortunately, so we need to get it from the
			// main models endpoint.
			switch (true) {
				case modelId.startsWith("anthropic/claude-3.7-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = id === "anthropic/claude-3.7-sonnet:thinking" ? 64_000 : 8192
					break
				case modelId.startsWith("anthropic/claude-3.5-sonnet-20240620"):
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					modelInfo.maxTokens = 8192
					break
				// kilocode_change start
				//default:
				//	modelInfo.supportsPromptCache = true
				//	modelInfo.cacheWritesPrice = 0.3
				//	modelInfo.cacheReadsPrice = 0.03
				//	break
				// kilocode_change end
			}

			models[providerName] = modelInfo
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			console.error(`OpenRouter API response validation failed:`, error.errors)
		} else {
			console.error(`Error fetching OpenRouter providers:`, error)
		}
	}

	return models
}

type UseOpenRouterModelProvidersOptions = Omit<
	UseQueryOptions<Record<string, OpenRouterModelProvider>>,
	"queryKey" | "queryFn"
>

// kilocode_change start: baseUrl, apiKey
export const useOpenRouterModelProviders = (
	modelId?: string,
	baseUrl?: string,
	apiKey?: string,
	options?: UseOpenRouterModelProvidersOptions,
) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId, baseUrl, apiKey],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId, baseUrl, apiKey) : {}),
		...options,
	})
// kilocode_change end
