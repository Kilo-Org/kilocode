import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import type { ModelInfo } from "@roo-code/types"

//TODO: import { parseApiPrice } from "@roo/cost"

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

type OpenRouterModelProvider = ModelInfo & {
	label: string
}

// kilocode_change: baseUrl, apiKey
async function getOpenRouterProvidersForModel(modelId: string, baseUrl?: string, apiKey?: string) {
	const models: Record<string, OpenRouterModelProvider> = {}

	try {
		// kilocode_change start: baseUrl, apiKey
		const response = await axios.get(
			`${baseUrl?.trim() || "https://api.matterai.so/v1/web"}/models/${modelId}`,
			{ headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }, // 60 seconds timeout
		)

		// console.log("response", response)
		// // kilocode_change end
		// const result = openRouterModelSchema.safeParse(response.data)

		// console.log("result", result)

		// if (!result.success) {
		// 	console.error("OpenRouter API response validation failed:", result.error)
		// 	return models
		// }

		// const { description, architecture, context_length, max_completion_tokens, pricing, provider_name, tag } = result.data.data

		// // Skip image generation models (models that output images)
		// if (architecture?.output_modalities?.includes("image")) {
		// 	return models
		// }

		// const providerName = tag ?? provider_name // kilocode_change
		// const inputPrice = parseApiPrice(pricing?.prompt)
		// const outputPrice = parseApiPrice(pricing?.completion)
		// const cacheReadsPrice = parseApiPrice(pricing?.input_cache_read)
		// const cacheWritesPrice = parseApiPrice(pricing?.input_cache_write)

		// const modelInfo: OpenRouterModelProvider = {
		// 	maxTokens: max_completion_tokens || context_length,
		// 	contextWindow: context_length,
		// 	supportsImages: architecture?.input_modalities?.includes("image") ?? false,
		// 	supportsPromptCache: typeof cacheReadsPrice !== "undefined",
		// 	cacheReadsPrice,
		// 	cacheWritesPrice,
		// 	inputPrice,
		// 	outputPrice,
		// 	description,
		// 	label: providerName,
		// }

		// // TODO: This is wrong. We need to fetch the model info from
		// // OpenRouter instead of hardcoding it here. The endpoints payload
		// // doesn't include this unfortunately, so we need to get it from the
		// // main models endpoint.
		// // Removed switch statement as we only have 1 provider

		models["KiloCode"] = response.data
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

// kilocode_change start: baseUrl, apiKey, organizationId
export const useOpenRouterModelProviders = (
	modelId?: string,
	baseUrl?: string,
	apiKey?: string,
	organizationId?: string,
	options?: UseOpenRouterModelProvidersOptions,
) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId, baseUrl, apiKey, organizationId],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId, baseUrl, apiKey) : {}),
		...options,
	})
// kilocode_change end
