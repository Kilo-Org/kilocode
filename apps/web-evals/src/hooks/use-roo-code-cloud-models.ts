import { z } from "zod"
import { useQuery } from "@tanstack/react-query"
import { useFuzzyModelSearch } from "./use-fuzzy-model-search"

export const rooCodeCloudModelSchema = z.object({
	object: z.literal("model"),
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	context_window: z.number(),
	max_tokens: z.number(),
	supports_images: z.boolean().optional(),
	supports_prompt_cache: z.boolean().optional(),
	type: z.literal("language"),
	tags: z.array(z.string()).optional(),
	deprecationMessage: z.string().optional(),
	owned_by: z.string(),
	pricing: z.object({
		input: z.string(),
		output: z.string(),
		input_cache_read: z.string().optional(),
		input_cache_write: z.string().optional(),
	}),
	evals: z
		.object({
			score: z.number().min(0).max(100),
		})
		.optional(),
	created: z.number(),
	deprecated: z.boolean().optional(),
})

export type RooCodeCloudModel = z.infer<typeof rooCodeCloudModelSchema>

export const getRooCodeCloudModels = async (): Promise<RooCodeCloudModel[]> => {
	const response = await fetch("https://api.roocode.com/proxy/v1/models")

	if (!response.ok) {
		return []
	}

	const result = z
		.object({
			object: z.literal("list"),
			data: z.array(rooCodeCloudModelSchema),
		})
		.safeParse(await response.json())

	if (!result.success) {
		console.error(result.error)
		return []
	}

	return result.data.data.filter((model) => !model.deprecated).sort((a, b) => a.name.localeCompare(b.name))
}

export const useRooCodeCloudModels = () => {
	const query = useQuery({
		queryKey: ["getRooCodeCloudModels"],
		queryFn: getRooCodeCloudModels,
	})

	const { searchValue, setSearchValue, onFilter } = useFuzzyModelSearch(query.data)

	return { ...query, searchValue, setSearchValue, onFilter }
}
