import { OpenAi } from "./providers/openai.js"
import { LlmInfoWithProvider, ModelProvider } from "./types.js"

const allModelProviders: ModelProvider[] = [OpenAi]

const allLlms: LlmInfoWithProvider[] = allModelProviders.flatMap((provider) =>
	provider.models.map((model) => ({ ...model, provider: provider.id })),
)

export function findLlmInfo(model: string, preferProviderId?: string): LlmInfoWithProvider | undefined {
	if (preferProviderId) {
		const provider = allModelProviders.find((p) => p.id === preferProviderId)
		const info = provider?.models.find((llm) => (llm.regex ? llm.regex.test(model) : llm.model === model))
		if (info) {
			return {
				...info,
				provider: preferProviderId,
			}
		}
	}
	return allLlms.find((llm) => (llm.regex ? llm.regex.test(model) : llm.model === model))
}
