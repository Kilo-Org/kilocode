import axios from "axios"

import {
	getProviderManifest,
	getProviderModels,
	getProviderModelsFromCache,
	clearAllProviderDefinedCaches,
	parseEmbeddedProviderData,
} from "../provider-defined"

vi.mock("axios")
const mockedAxios = vi.mocked(axios, true)

describe("provider-defined fetchers", () => {
	const manifestUrl = "https://api.example.com/v1/models?provider=true"

	beforeEach(() => {
		clearAllProviderDefinedCaches()
		mockedAxios.get.mockReset()
	})

	describe("getProviderManifest", () => {
		const manifestResponse = {
			name: "Example Provider",
			website: "https://example.com",
			baseUrl: "https://api.example.com/v1",
			models_data_source: "endpoint" as const,
		}

		it("fetches and caches the manifest", async () => {
			mockedAxios.get.mockResolvedValue({ data: manifestResponse })

			const manifest = await getProviderManifest(manifestUrl)
			expect(manifest).toEqual(manifestResponse)
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(manifestUrl, { headers: undefined })

			// Second call should use cache and avoid HTTP request
			const manifestCached = await getProviderManifest(manifestUrl)
			expect(manifestCached).toEqual(manifestResponse)
			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
		})
	})

	describe("getProviderModels", () => {
		it("retrieves models from provider endpoint and caches them", async () => {
			const manifestResponse = {
				name: "Example Provider",
				website: "https://example.com",
				baseUrl: "https://api.example.com/v1",
				models_data_source: "endpoint" as const,
			}

			const endpointResponse = {
				models: {
					"example/model-v1": {
						id: "example/model-v1",
						name: "Example Model",
						reasoning: true,
						temperature: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						cost: { input: 0.1, output: 0.2, cache_read: 0.01, cache_write: 0.02 },
						limit: { context: 131072, output: 4096 },
						description: "An example model",
					},
				},
			}

			mockedAxios.get.mockImplementation(async (url: string) => {
				if (url === manifestUrl) {
					return { data: manifestResponse }
				}

				if (url.startsWith("https://api.example.com/v1/models")) {
					return { data: endpointResponse }
				}

				throw new Error(`Unexpected request to ${url}`)
			})

			const models = await getProviderModels({ manifestUrl })
			expect(Object.keys(models)).toEqual(["example/model-v1"])

			const info = models["example/model-v1"]
			expect(info.contextWindow).toBe(131072)
			expect(info.maxTokens).toBe(4096)
			expect(info.supportsImages).toBe(true)
			expect(info.supportsPromptCache).toBe(true)
			expect(info.inputPrice).toBe(0.1)
			expect(info.outputPrice).toBe(0.2)
			expect(info.cacheReadsPrice).toBe(0.01)
			expect(info.cacheWritesPrice).toBe(0.02)
			expect(info.supportsReasoningBudget).toBe(true)
			expect(info.supportsTemperature).toBe(true)

			// Verify cache hit avoids additional HTTP calls
			mockedAxios.get.mockClear()
			const cached = await getProviderModels({ manifestUrl })
			expect(cached).toEqual(models)
			expect(mockedAxios.get).not.toHaveBeenCalled()

			// Cached helper should return the same data
			const cachedDirect = getProviderModelsFromCache(manifestUrl)
			expect(cachedDirect).toEqual(models)
		})

		it("retrieves models from models.dev when configured", async () => {
			const manifestResponse = {
				name: "Models Dev Provider",
				website: "https://example.com",
				baseUrl: "https://api.example.com/v1",
				models_data_source: "models_dev" as const,
				models_dev_provider_id: "test-provider",
			}

			const modelsDevResponse = {
				"test-provider": {
					id: "test-provider",
					name: "Test Provider",
					models: {
						"test/model": {
							id: "test/model",
							name: "Test Model",
							modalities: { input: ["text"], output: ["text"] },
							cost: { input: 0.05, output: 0.15 },
							limit: { context: 65536, output: 8192 },
							reasoning: false,
						},
					},
				},
			}

			mockedAxios.get.mockImplementation(async (url: string) => {
				if (url === manifestUrl) {
					return { data: manifestResponse }
				}

				if (url === "https://models.dev/api.json") {
					return { data: modelsDevResponse }
				}

				throw new Error(`Unexpected request to ${url}`)
			})

			const models = await getProviderModels({ manifestUrl })
			expect(Object.keys(models)).toEqual(["test/model"])
			const info = models["test/model"]
			expect(info.contextWindow).toBe(65536)
			expect(info.maxTokens).toBe(8192)
			expect(info.supportsImages).toBe(false)
			expect(info.supportsPromptCache).toBe(false)
			expect(info.inputPrice).toBe(0.05)
			expect(info.outputPrice).toBe(0.15)

			// Second call uses cache for manifest and models.dev data
			mockedAxios.get.mockClear()
			await getProviderModels({ manifestUrl })
			expect(mockedAxios.get).not.toHaveBeenCalled()
		})

		it("parses embedded provider data", () => {
			const embeddedModelsResponse = {
				models: {
					"example/model-v1": {
						id: "example/model-v1",
						name: "Example Model",
					},
				},
			}

			const embeddedJson = JSON.stringify([
				{
					name: "Embedded Provider",
					website: "https://embedded.example.com",
					baseUrl: "https://embedded.example.com/v1",
					models_data_source: "embedded" as const,
				},
				embeddedModelsResponse,
			])

			const embedded = parseEmbeddedProviderData(embeddedJson)
			expect(embedded.manifest.name).toBe("Embedded Provider")
			expect(Object.keys(embedded.models)).toEqual(["example/model-v1"])
		})
	})
})
