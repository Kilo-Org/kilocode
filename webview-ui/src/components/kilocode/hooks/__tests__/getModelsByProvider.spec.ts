import {
	ModelInfo,
	ProviderName,
	providerNames,
	internationalZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiModels,
	mainlandZAiDefaultModelId,
} from "@roo-code/types"
import { RouterModels } from "@roo/api"
import { getModelsByProvider, getOptionsForProvider } from "../useProviderModels"

describe("getModelsByProvider", () => {
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
		"nano-gpt": { "test-model": testModel },
		ollama: { "test-model": testModel },
		lmstudio: { "test-model": testModel },
		"io-intelligence": { "test-model": testModel },
		deepinfra: { "test-model": testModel },
		"vercel-ai-gateway": { "test-model": testModel },
		huggingface: { "test-model": testModel },
		gemini: { "test-model": testModel },
		ovhcloud: { "test-model": testModel },
		chutes: { "test-model": testModel },
		"sap-ai-core": { "test-model": testModel },
		synthetic: { "test-model": testModel },
		inception: { "test-model": testModel },
		roo: { "test-model": testModel },
	}

	it("returns models for all providers", () => {
		const exceptions = [
			"fake-ai", // don't know what this is
			"huggingface", // don't know what this is
			"human-relay", // no models
			"nano-gpt", // dynamic provider - models fetched from API
			"openai", // not implemented
			"roo", // don't care
			"virtual-quota-fallback", // no models
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
							options: {},
						}),
					] satisfies [ProviderName, ReturnType<typeof getModelsByProvider>],
			)
			.filter((provider) => exceptions.indexOf(provider[0]) < 0 && Object.values(provider[1].models).length === 0)
			.map((provider) => provider[0])

		expect(providersWithoutModels).toStrictEqual([])
	})

	it("returns international Z.AI models when isChina is false", () => {
		const result = getModelsByProvider({
			provider: "zai",
			routerModels,
			kilocodeDefaultModel: "test-default-model",
			options: { isChina: false },
		})

		expect(result.models).toEqual(internationalZAiModels)
		expect(result.defaultModel).toEqual(internationalZAiDefaultModelId)
	})

	it("returns mainland Z.AI models when isChina is true", () => {
		const result = getModelsByProvider({
			provider: "zai",
			routerModels,
			kilocodeDefaultModel: "test-default-model",
			options: { isChina: true },
		})

		expect(result.models).toEqual(mainlandZAiModels)
		expect(result.defaultModel).toEqual(mainlandZAiDefaultModelId)
	})
})

describe("getOptionsForProvider", () => {
	it("returns default options for non-zai providers", () => {
		const result = getOptionsForProvider("openrouter")
		expect(result).toEqual({})
	})

	it("returns isChina: false for zai provider with default apiConfiguration", () => {
		const result = getOptionsForProvider("zai", { zaiApiLine: "international_coding" })
		expect(result).toEqual({ isChina: false })
	})

	it("returns isChina: true for zai provider with china_coding apiConfiguration", () => {
		const result = getOptionsForProvider("zai", { zaiApiLine: "china_coding" })
		expect(result).toEqual({ isChina: true })
	})
})
