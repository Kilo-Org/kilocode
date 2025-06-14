import { z } from "zod"
import { useQuery } from "@tanstack/react-query"

export const openRouterModelSchema = z.object({
	id: z.string(),
	name: z.string(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

export const getOpenRouterModels = async (baseUrl?: string): Promise<OpenRouterModel[]> => {
	const url = baseUrl || "https://openrouter.ai/api/v1"
	const response = await fetch(`${url}/models`)

	if (!response.ok) {
		return []
	}

	const result = z.object({ data: z.array(openRouterModelSchema) }).safeParse(await response.json())

	if (!result.success) {
		console.error(result.error)
		return []
	}

	return result.data.data.sort((a, b) => a.name.localeCompare(b.name))
}

export const useOpenRouterModels = (baseUrl?: string) =>
	useQuery({
		queryKey: ["getOpenRouterModels", baseUrl],
		queryFn: () => getOpenRouterModels(baseUrl),
	})
