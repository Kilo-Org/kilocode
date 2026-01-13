// npx vitest run api/providers/fetchers/__tests__/modelEndpointCache.spec.ts

import { vi, describe, it, expect, beforeEach } from "vitest"
import { getModelEndpoints } from "../modelEndpointCache"
import * as modelCache from "../modelCache"
import * as openrouter from "../openrouter"

vi.mock("../modelCache")
vi.mock("../openrouter")

describe("modelEndpointCache", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getModelEndpoints", () => {
		it("should copy model-level capabilities from parent model to endpoints", async () => {
			// Mock the parent model data with native tools support
			const mockParentModels = {
				"anthropic/claude-sonnet-4": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsNativeTools: true, // Parent supports native tools
					supportsReasoningEffort: true,
					supportedParameters: ["max_tokens", "temperature", "reasoning"] as any,
					inputPrice: 3,
					outputPrice: 15,
				},
			}

			// Mock endpoint data WITHOUT capabilities (as returned by API)
			const mockEndpoints = {
				anthropic: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3,
					outputPrice: 15,
					// Note: No supportsNativeTools, supportsReasoningEffort, or supportedParameters
				},
				"amazon-bedrock": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3,
					outputPrice: 15,
				},
			}

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

			const result = await getModelEndpoints({
				router: "openrouter",
				modelId: "anthropic/claude-sonnet-4",
				endpoint: "anthropic",
			})

			// Verify capabilities were copied from parent to ALL endpoints
			expect(result.anthropic.supportsNativeTools).toBe(true)
			expect(result.anthropic.supportsReasoningEffort).toBe(true)
			expect(result.anthropic.supportedParameters).toEqual(["max_tokens", "temperature", "reasoning"])

			expect(result["amazon-bedrock"].supportsNativeTools).toBe(true)
			expect(result["amazon-bedrock"].supportsReasoningEffort).toBe(true)
			expect(result["amazon-bedrock"].supportedParameters).toEqual(["max_tokens", "temperature", "reasoning"])
		})

		it("should create independent array copies to avoid shared references", async () => {
			const mockParentModels = {
				"test/model": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
					supportsNativeTools: true,
					supportedParameters: ["max_tokens", "temperature"] as any,
				},
			}

			const mockEndpoints = {
				"endpoint-1": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
				},
				"endpoint-2": {
					maxTokens: 1000,
					contextWindow: 10000,
					supportsPromptCache: false,
				},
			}

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

			const result = await getModelEndpoints({
				router: "openrouter",
				modelId: "test/model",
				endpoint: "endpoint-1",
			})

			// Modify one endpoint's array
			result["endpoint-1"].supportedParameters?.push("reasoning" as any)

			// Verify the other endpoint's array was NOT affected (independent copy)
			expect(result["endpoint-1"].supportedParameters).toHaveLength(3)
			expect(result["endpoint-2"].supportedParameters).toHaveLength(2)
		})

		it("should handle missing parent model gracefully", async () => {
			const mockParentModels = {}
			const mockEndpoints = {
				anthropic: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
				},
			}

			vi.spyOn(modelCache, "getModels").mockResolvedValue(mockParentModels as any)
			vi.spyOn(openrouter, "getOpenRouterModelEndpoints").mockResolvedValue(mockEndpoints as any)

			const result = await getModelEndpoints({
				router: "openrouter",
				modelId: "missing/model",
				endpoint: "anthropic",
			})

			// Should not crash, but capabilities will be undefined
			expect(result.anthropic).toBeDefined()
			expect(result.anthropic.supportsNativeTools).toBeUndefined()
		})

		it("should return empty object for non-openrouter providers", async () => {
			const result = await getModelEndpoints({
				router: "vercel-ai-gateway",
				modelId: "claude-sonnet-4",
				endpoint: "default",
			})

			expect(result).toEqual({})
		})

		it("should return empty object when modelId or endpoint is missing", async () => {
			const result1 = await getModelEndpoints({
				router: "openrouter",
				modelId: undefined,
				endpoint: "anthropic",
			})

			const result2 = await getModelEndpoints({
				router: "openrouter",
				modelId: "anthropic/claude-sonnet-4",
				endpoint: undefined,
			})

			expect(result1).toEqual({})
			expect(result2).toEqual({})
		})
	})
})
