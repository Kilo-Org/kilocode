import { ModelInfo, ProviderName, providerNames } from "@roo-code/types"
import { RouterModels } from "@roo/api"
import { getModelsByProvider } from "../useProviderModels"

describe("getModelsByProvider", () => {
	it("returns models for all providers", () => {
		const testModel: ModelInfo = {
			maxTokens: 4096,
			contextWindow: 8192,
			supportsImages: false,
			supportsPromptCache: false,
			inputPrice: 0.1,
			outputPrice: 0.2,
			description: "Test model",
		}

		const routerModels: RouterModels = {
			openrouter: { "test-model": testModel },
			requesty: { "test-model": testModel },
			glama: { "test-model": testModel },
			unbound: { "test-model": testModel },
			litellm: { "test-model": testModel },
			kilocode: { "test-model": testModel },
			ollama: { "test-model": testModel },
			lmstudio: { "test-model": testModel },
			"io-intelligence": { "test-model": testModel },
			deepinfra: { "test-model": testModel },
			"vercel-ai-gateway": { "test-model": testModel },
			huggingface: { "test-model": testModel },
			gemini: { "test-model": testModel },
			ovhcloud: { "test-model": testModel },
			chutes: { "test-model": testModel },
			synthetic: { "test-model": testModel }, // kilocode_change
			inception: { "test-model": testModel },
			roo: { "test-model": testModel },
		}

		const exceptions = [
			"fake-ai", // don't know what this is
			"huggingface", // don't know what this is
			"human-relay", // no models
			"openai", // not implemented
			"roo", // don't care
			"virtual-quota-fallback", // no models
			"zai", // has weird mainland/international distiction
			"vercel-ai-gateway", // different structure
		]

		const providersWithoutModels = providerNames
			.map(
				(provider) =>
					[
						provider,
						getModelsByProvider({
							provider,
							routerModels,
							kilocodeDefaultModel: "test-default-model",
						}),
					] satisfies [ProviderName, ReturnType<typeof getModelsByProvider>],
			)
			.filter((provider) => exceptions.indexOf(provider[0]) < 0 && Object.values(provider[1].models).length === 0)
			.map((provider) => provider[0])

		expect(providersWithoutModels).toStrictEqual([])
	})
})
