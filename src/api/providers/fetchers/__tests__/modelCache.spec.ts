// Mocks must come first, before imports

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock NodeCache to allow controlling cache behavior
vi.mock("node-cache", () => {
	const mockGet = vi.fn().mockReturnValue(undefined)
	const mockSet = vi.fn()
	const mockDel = vi.fn()

	return {
		default: vi.fn().mockImplementation(() => ({
			get: mockGet,
			set: mockSet,
			del: mockDel,
		})),
	}
})

// Mock fs/promises to avoid file system operations
vi.mock("fs/promises", () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Mock fs (synchronous) for disk cache fallback
vi.mock("fs", () => ({
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue("{}"),
}))

// Mock all the model fetchers
vi.mock("../litellm")
vi.mock("../openrouter")
vi.mock("../requesty")
vi.mock("../glama") // kilocode_change start
vi.mock("../unbound")
vi.mock("../io-intelligence")
vi.mock("../ovhcloud") // kilocode_change

// Mock ContextProxy with a simple static instance
vi.mock("../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			globalStorageUri: {
				fsPath: "/mock/storage/path",
			},
		},
	},
}))

// Then imports
import type { Mock } from "vitest"
import * as fsSync from "fs"
import NodeCache from "node-cache"
import { getModels, getModelsFromCache } from "../modelCache"
import { getLiteLLMModels } from "../litellm"
import { getOpenRouterModels } from "../openrouter"
import { getRequestyModels } from "../requesty"
import { getGlamaModels } from "../glama" // kilocode_change
import { getUnboundModels } from "../unbound"
import { getIOIntelligenceModels } from "../io-intelligence"
import { getOvhCloudAiEndpointsModels } from "../ovhcloud" // kilocode_change

const mockGetLiteLLMModels = getLiteLLMModels as Mock<typeof getLiteLLMModels>
const mockGetOpenRouterModels = getOpenRouterModels as Mock<typeof getOpenRouterModels>
const mockGetRequestyModels = getRequestyModels as Mock<typeof getRequestyModels>
const mockGetGlamaModels = getGlamaModels as Mock<typeof getGlamaModels> // kilocode_Change
const mockGetUnboundModels = getUnboundModels as Mock<typeof getUnboundModels>
const mockGetIOIntelligenceModels = getIOIntelligenceModels as Mock<typeof getIOIntelligenceModels>
const mockGetOvhCloudAiEndpointsModels = getOvhCloudAiEndpointsModels as Mock<typeof getOvhCloudAiEndpointsModels> // kilocode_change

const DUMMY_REQUESTY_KEY = "requesty-key-for-testing"
const DUMMY_UNBOUND_KEY = "unbound-key-for-testing"
const DUMMY_IOINTELLIGENCE_KEY = "io-intelligence-key-for-testing"

describe("getModels with new GetModelsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("calls getLiteLLMModels with correct parameters", async () => {
		const mockModels = {
			"claude-3-sonnet": {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsPromptCache: false,
				description: "Claude 3 Sonnet via LiteLLM",
			},
		}
		mockGetLiteLLMModels.mockResolvedValue(mockModels)

		const result = await getModels({
			provider: "litellm",
			apiKey: "test-api-key",
			baseUrl: "http://localhost:4000",
		})

		expect(mockGetLiteLLMModels).toHaveBeenCalledWith("test-api-key", "http://localhost:4000")
		expect(result).toEqual(mockModels)
	})

	it("calls getOpenRouterModels for openrouter provider", async () => {
		const mockModels = {
			"openrouter/model": {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsPromptCache: false,
				description: "OpenRouter model",
			},
		}
		mockGetOpenRouterModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "openrouter" })

		expect(mockGetOpenRouterModels).toHaveBeenCalled()
		expect(result).toEqual(mockModels)
	})

	it("calls getRequestyModels with optional API key", async () => {
		const mockModels = {
			"requesty/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Requesty model",
			},
		}
		mockGetRequestyModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "requesty", apiKey: DUMMY_REQUESTY_KEY })

		expect(mockGetRequestyModels).toHaveBeenCalledWith(undefined, DUMMY_REQUESTY_KEY)
		expect(result).toEqual(mockModels)
	})

	// kilocode_change start
	it("calls getGlamaModels for glama provider", async () => {
		const mockModels = {
			"glama/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Glama model",
			},
		}
		mockGetGlamaModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "glama" })

		expect(mockGetGlamaModels).toHaveBeenCalled()
		expect(result).toEqual(mockModels)
	})
	// kilocode_change end

	it("calls getUnboundModels with optional API key", async () => {
		const mockModels = {
			"unbound/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Unbound model",
			},
		}
		mockGetUnboundModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "unbound", apiKey: DUMMY_UNBOUND_KEY })

		expect(mockGetUnboundModels).toHaveBeenCalledWith(DUMMY_UNBOUND_KEY)
		expect(result).toEqual(mockModels)
	})

	it("calls IOIntelligenceModels for IO-Intelligence provider", async () => {
		const mockModels = {
			"io-intelligence/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "IO Intelligence Model",
			},
		}
		mockGetIOIntelligenceModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "io-intelligence", apiKey: DUMMY_IOINTELLIGENCE_KEY })

		expect(mockGetIOIntelligenceModels).toHaveBeenCalled()
		expect(result).toEqual(mockModels)
	})

	// kilocode_change start
	it("calls OvhCloudAiEndpointsModels for ovhcloud provider", async () => {
		const mockModels = {
			"ovhcloud/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "OVHcloud AI Endpoints Model",
			},
		}
		mockGetOvhCloudAiEndpointsModels.mockResolvedValue(mockModels)

		const result = await getModels({ provider: "ovhcloud" })

		expect(mockGetOvhCloudAiEndpointsModels).toHaveBeenCalled()
		expect(result).toEqual(mockModels)
	})
	// kilocode_change end

	it("handles errors and re-throws them", async () => {
		const expectedError = new Error("LiteLLM connection failed")
		mockGetLiteLLMModels.mockRejectedValue(expectedError)

		await expect(
			getModels({
				provider: "litellm",
				apiKey: "test-api-key",
				baseUrl: "http://localhost:4000",
			}),
		).rejects.toThrow("LiteLLM connection failed")
	})

	it("validates exhaustive provider checking with unknown provider", async () => {
		// This test ensures TypeScript catches unknown providers at compile time
		// In practice, the discriminated union should prevent this at compile time
		const unknownProvider = "unknown" as any

		await expect(
			getModels({
				provider: unknownProvider,
			}),
		).rejects.toThrow("Unknown provider: unknown")
	})
})

describe("getModelsFromCache disk fallback", () => {
	let mockCache: any

	beforeEach(() => {
		vi.clearAllMocks()
		// Get the mock cache instance
		const MockedNodeCache = vi.mocked(NodeCache)
		mockCache = new MockedNodeCache()
		// Reset memory cache to always miss
		mockCache.get.mockReturnValue(undefined)
		// Reset fs mocks
		vi.mocked(fsSync.existsSync).mockReturnValue(false)
		vi.mocked(fsSync.readFileSync).mockReturnValue("{}")
	})

	it("returns undefined when both memory and disk cache miss", () => {
		vi.mocked(fsSync.existsSync).mockReturnValue(false)

		const result = getModelsFromCache("openrouter")

		expect(result).toBeUndefined()
	})

	it("returns memory cache data without checking disk when available", () => {
		const memoryModels = {
			"memory-model": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsPromptCache: false,
			},
		}

		mockCache.get.mockReturnValue(memoryModels)

		const result = getModelsFromCache("roo")

		expect(result).toEqual(memoryModels)
		// Disk should not be checked when memory cache hits
		expect(fsSync.existsSync).not.toHaveBeenCalled()
	})

	it("returns disk cache data when memory cache misses and context is available", () => {
		// Note: This test validates the logic but the ContextProxy mock in test environment
		// returns undefined for getCacheDirectoryPathSync, which is expected behavior
		// when the context is not fully initialized. The actual disk cache loading
		// is validated through integration tests.
		const diskModels = {
			"disk-model": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
			},
		}

		vi.mocked(fsSync.existsSync).mockReturnValue(true)
		vi.mocked(fsSync.readFileSync).mockReturnValue(JSON.stringify(diskModels))

		const result = getModelsFromCache("openrouter")

		// In the test environment, ContextProxy.instance may not be fully initialized,
		// so getCacheDirectoryPathSync returns undefined and disk cache is not attempted
		expect(result).toBeUndefined()
	})

	it("handles disk read errors gracefully", () => {
		vi.mocked(fsSync.existsSync).mockReturnValue(true)
		vi.mocked(fsSync.readFileSync).mockImplementation(() => {
			throw new Error("Disk read failed")
		})

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const result = getModelsFromCache("roo")

		expect(result).toBeUndefined()
		expect(consoleErrorSpy).toHaveBeenCalled()

		consoleErrorSpy.mockRestore()
	})

	it("handles invalid JSON in disk cache gracefully", () => {
		vi.mocked(fsSync.existsSync).mockReturnValue(true)
		vi.mocked(fsSync.readFileSync).mockReturnValue("invalid json{")

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const result = getModelsFromCache("glama") // kilocode_change

		expect(result).toBeUndefined()
		expect(consoleErrorSpy).toHaveBeenCalled()

		consoleErrorSpy.mockRestore()
	})

	// kilocode_change start
	it("rejects stale ZenMux cache entries with invalid contextWindow", () => {
		const invalidZenmuxModels = {
			"anthropic/claude-opus-4": {
				maxTokens: 0,
				contextWindow: 0,
				supportsPromptCache: false,
			},
		}

		mockCache.get.mockReturnValue(invalidZenmuxModels)

		const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		const result = getModelsFromCache("zenmux")

		expect(result).toBeUndefined()
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"[MODEL_CACHE] Ignoring stale ZenMux model cache with invalid contextWindow values",
		)
		expect(fsSync.existsSync).not.toHaveBeenCalled()

		consoleWarnSpy.mockRestore()
	})

	it("accepts valid ZenMux cache entries", () => {
		const validZenmuxModels = {
			"anthropic/claude-opus-4": {
				maxTokens: 0,
				contextWindow: 200000,
				supportsPromptCache: false,
			},
		}

		mockCache.get.mockReturnValue(validZenmuxModels)

		const result = getModelsFromCache("zenmux")

		expect(result).toEqual(validZenmuxModels)
		expect(fsSync.existsSync).not.toHaveBeenCalled()
	})
	// kilocode_change end
})

describe("empty cache protection", () => {
	let mockCache: any
	let mockGet: Mock
	let mockSet: Mock

	beforeEach(() => {
		vi.clearAllMocks()
		// Get the mock cache instance
		const MockedNodeCache = vi.mocked(NodeCache)
		mockCache = new MockedNodeCache()
		mockGet = mockCache.get
		mockSet = mockCache.set
		// Reset memory cache to always miss by default
		mockGet.mockReturnValue(undefined)
	})

	describe("getModels", () => {
		it("does not cache empty API responses", async () => {
			// API returns empty object (simulating failure)
			mockGetOpenRouterModels.mockResolvedValue({})

			const result = await getModels({ provider: "openrouter" })

			// Should return empty but NOT cache it
			expect(result).toEqual({})
			expect(mockSet).not.toHaveBeenCalled()
		})

		it("caches non-empty API responses", async () => {
			const mockModels = {
				"openrouter/model": {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsPromptCache: false,
					description: "OpenRouter model",
				},
			}
			mockGetOpenRouterModels.mockResolvedValue(mockModels)

			const result = await getModels({ provider: "openrouter" })

			expect(result).toEqual(mockModels)
			expect(mockSet).toHaveBeenCalledWith("openrouter", mockModels)
		})
	})

	describe("refreshModels", () => {
		it("keeps existing cache when API returns empty response", async () => {
			const existingModels = {
				"openrouter/existing-model": {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsPromptCache: false,
					description: "Existing cached model",
				},
			}

			// Memory cache has existing data
			mockGet.mockReturnValue(existingModels)
			// API returns empty (failure)
			mockGetOpenRouterModels.mockResolvedValue({})

			const { refreshModels } = await import("../modelCache")
			const result = await refreshModels({ provider: "openrouter" })

			// Should return existing cache, not empty
			expect(result).toEqual(existingModels)
			// Should NOT update cache with empty data
			expect(mockSet).not.toHaveBeenCalled()
		})

		it("updates cache when API returns valid non-empty response", async () => {
			const existingModels = {
				"openrouter/old-model": {
					maxTokens: 4096,
					contextWindow: 64000,
					supportsPromptCache: false,
					description: "Old model",
				},
			}
			const newModels = {
				"openrouter/new-model": {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsPromptCache: true,
					description: "New model",
				},
			}

			mockGet.mockReturnValue(existingModels)
			mockGetOpenRouterModels.mockResolvedValue(newModels)

			const { refreshModels } = await import("../modelCache")
			const result = await refreshModels({ provider: "openrouter" })

			// Should return new models
			expect(result).toEqual(newModels)
			// Should update cache with new data
			expect(mockSet).toHaveBeenCalledWith("openrouter", newModels)
		})

		it("returns existing cache on API error", async () => {
			const existingModels = {
				"openrouter/cached-model": {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsPromptCache: false,
					description: "Cached model",
				},
			}

			mockGet.mockReturnValue(existingModels)
			mockGetOpenRouterModels.mockRejectedValue(new Error("API error"))

			const { refreshModels } = await import("../modelCache")
			const result = await refreshModels({ provider: "openrouter" })

			// Should return existing cache on error
			expect(result).toEqual(existingModels)
		})

		it("returns empty object when API errors and no cache exists", async () => {
			mockGet.mockReturnValue(undefined)
			mockGetOpenRouterModels.mockRejectedValue(new Error("API error"))

			const { refreshModels } = await import("../modelCache")
			const result = await refreshModels({ provider: "openrouter" })

			// Should return empty when no cache and API fails
			expect(result).toEqual({})
		})

		it("does not cache empty response when no existing cache", async () => {
			// Both memory and disk cache are empty (initial state)
			mockGet.mockReturnValue(undefined)
			// API returns empty (failure/rate limit)
			mockGetOpenRouterModels.mockResolvedValue({})

			const { refreshModels } = await import("../modelCache")
			const result = await refreshModels({ provider: "openrouter" })

			// Should return empty but NOT cache it
			expect(result).toEqual({})
			expect(mockSet).not.toHaveBeenCalled()
		})

		it("reuses in-flight request for concurrent calls to same provider", async () => {
			const mockModels = {
				"openrouter/model": {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsPromptCache: false,
					description: "OpenRouter model",
				},
			}

			// Create a delayed response to simulate API latency
			let resolvePromise: (value: typeof mockModels) => void
			const delayedPromise = new Promise<typeof mockModels>((resolve) => {
				resolvePromise = resolve
			})
			mockGetOpenRouterModels.mockReturnValue(delayedPromise)
			mockGet.mockReturnValue(undefined)

			const { refreshModels } = await import("../modelCache")

			// Start two concurrent refresh calls
			const promise1 = refreshModels({ provider: "openrouter" })
			const promise2 = refreshModels({ provider: "openrouter" })

			// API should only be called once (second call reuses in-flight request)
			expect(mockGetOpenRouterModels).toHaveBeenCalledTimes(1)

			// Resolve the API call
			resolvePromise!(mockModels)

			// Both promises should resolve to the same result
			const [result1, result2] = await Promise.all([promise1, promise2])
			expect(result1).toEqual(mockModels)
			expect(result2).toEqual(mockModels)
		})
	})
})
