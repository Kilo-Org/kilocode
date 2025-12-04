// kilocode_change - new file
// npx vitest run api/providers/fetchers/__tests__/sap-ai-core.spec.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as path from "path"
import { back as nockBack } from "nock"
import * as sapAiCore from "../sap-ai-core"
import axios, { AxiosResponse } from "axios"

nockBack.fixtures = path.join(__dirname, "fixtures")
nockBack.setMode("lockdown")

// Mock service key for testing
const mockServiceKey = JSON.stringify({
	clientid: "test-client-id",
	clientsecret: "test-client-secret",
	url: "https://test-auth-url.com",
	serviceurls: {
		AI_API_URL: "https://test-base-url.com",
	},
})

describe("SAP AI Core API", () => {
	describe("getSapAiCoreModels - with fixtures", () => {
		it("fetches models and validates schema", async () => {
			const { nockDone } = await nockBack("sap-ai-core-models.json")

			const models = await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")

			expect(models).toBeDefined()
			expect(Object.keys(models).length).toBeGreaterThan(0)

			// Check a specific model (adjust based on your actual data)
			const sampleModel = models["gpt-4o-mini"]
			if (sampleModel) {
				expect(sampleModel).toEqual({
					contextWindow: expect.any(Number),
					supportsImages: expect.any(Boolean),
					supportsPromptCache: expect.any(Boolean),
					inputPrice: expect.any(Number),
					outputPrice: expect.any(Number),
					description: expect.any(String),
					displayName: expect.any(String),
					preferredIndex: undefined,
				})
			}

			nockDone()
		})

		it("fetches models with useOrchestration set to true", async () => {
			const { nockDone } = await nockBack("sap-ai-core-models-orchestration.json")

			const models = await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group", true)

			expect(models).toBeDefined()
			expect(Object.keys(models).length).toBeGreaterThanOrEqual(0)

			nockDone()
		})

		it("uses default resource group when not provided", async () => {
			const { nockDone } = await nockBack("sap-ai-core-models.json")

			const models = await sapAiCore.getSapAiCoreModels(mockServiceKey)

			expect(models).toBeDefined()
			nockDone()
		})

		it("throws error when service key is not provided", async () => {
			await expect(sapAiCore.getSapAiCoreModels(undefined)).rejects.toThrow("SAP AI Core service key is required")
		})

		it("throws error when service key is invalid JSON", async () => {
			await expect(sapAiCore.getSapAiCoreModels("invalid-json")).rejects.toThrow(
				"Failed to parse SAP AI Core service key",
			)
		})
	})

	describe("getSapAiCoreDeployments - with fixtures", () => {
		it("fetches deployments and validates schema", async () => {
			const { nockDone } = await nockBack("sap-ai-core-deployments.json")

			const deployments = await sapAiCore.getSapAiCoreDeployments(mockServiceKey, "test-resource-group")

			expect(deployments).toBeDefined()
			expect(Object.keys(deployments).length).toBeGreaterThanOrEqual(0)

			// Check a specific deployment if it exists
			const deploymentKeys = Object.keys(deployments)
			if (deploymentKeys.length > 0) {
				const sampleDeployment = deployments[deploymentKeys[0]]
				expect(sampleDeployment).toEqual({
					id: expect.any(String),
					name: expect.any(String),
					model: expect.any(String),
					targetStatus: expect.any(String),
				})
			}

			nockDone()
		})

		it("uses default resource group when not provided", async () => {
			const { nockDone } = await nockBack("sap-ai-core-deployments.json")

			const deployments = await sapAiCore.getSapAiCoreDeployments(mockServiceKey)

			expect(deployments).toBeDefined()
			nockDone()
		})

		it("throws error when service key is not provided", async () => {
			await expect(sapAiCore.getSapAiCoreDeployments(undefined)).rejects.toThrow(
				"SAP AI Core service key is required",
			)
		})
	})

	describe("Model Provider Caching", () => {
		beforeEach(() => {
			// Set nock to wild mode to disable interception for mocked tests
			nockBack.setMode("wild")
			vi.resetAllMocks()
		})

		afterEach(() => {
			vi.restoreAllMocks()
			// Reset nock back to lockdown mode
			nockBack.setMode("lockdown")
		})

		it("populates cache after fetching models", async () => {
			// Mock successful authentication
			const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
				data: { access_token: "test-token", expires_in: 3600 },
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			} as AxiosResponse)

			// Mock successful models and deployments API calls
			const mockModelsResponse = {
				data: {
					resources: [
						{
							model: "gpt-4",
							provider: "OpenAI",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
					],
				},
			}

			const mockDeploymentsResponse = {
				data: { resources: [] },
			}

			const axiosGetSpy = vi
				.spyOn(axios, "get")
				.mockResolvedValueOnce(mockModelsResponse)
				.mockResolvedValueOnce(mockDeploymentsResponse)

			// Fetch models to populate cache
			await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")

			// Verify cache is populated
			const provider = sapAiCore.getProviderForModel("gpt-4")
			expect(provider).toBe("OpenAI")

			expect(axiosPostSpy).toHaveBeenCalledOnce()
			expect(axiosGetSpy).toHaveBeenCalledTimes(2)
		})

		it("clears cache when fetching new models", async () => {
			// First, populate cache with one model
			const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValue({
				data: { access_token: "test-token", expires_in: 3600 },
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			} as AxiosResponse)

			const firstModelsResponse = {
				data: {
					resources: [
						{
							model: "claude-3",
							provider: "Anthropic",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
					],
				},
			}

			const mockDeploymentsResponse = {
				data: { resources: [] },
			}

			let axiosGetSpy = vi
				.spyOn(axios, "get")
				.mockResolvedValueOnce(firstModelsResponse)
				.mockResolvedValueOnce(mockDeploymentsResponse)

			await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")

			// Verify first model is cached
			expect(sapAiCore.getProviderForModel("claude-3")).toBe("Anthropic")

			// Now fetch different models (should clear cache)
			const secondModelsResponse = {
				data: {
					resources: [
						{
							model: "gpt-4",
							provider: "OpenAI",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
					],
				},
			}

			axiosGetSpy = vi
				.spyOn(axios, "get")
				.mockResolvedValueOnce(secondModelsResponse)
				.mockResolvedValueOnce(mockDeploymentsResponse)

			await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")

			// Verify cache was cleared and repopulated
			expect(sapAiCore.getProviderForModel("claude-3")).toBeUndefined() // Old model should be gone
			expect(sapAiCore.getProviderForModel("gpt-4")).toBe("OpenAI") // New model should be present
		})

		it("handles multiple models in cache", async () => {
			// Mock successful authentication
			const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
				data: { access_token: "test-token", expires_in: 3600 },
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			} as AxiosResponse)

			// Mock multiple models response
			const mockModelsResponse = {
				data: {
					resources: [
						{
							model: "gpt-4",
							provider: "OpenAI",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
						{
							model: "claude-3-sonnet",
							provider: "Anthropic",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
						{
							model: "gemini-pro",
							provider: "Google",
							allowedScenarios: [{ scenarioId: "foundation-models" }],
							versions: [
								{
									isLatest: true,
									streamingSupported: true,
									capabilities: ["text-generation"],
									contextLength: 32000,
									cost: [{ inputCost: "0.01" }, { outputCost: "0.03" }],
								},
							],
						},
					],
				},
			}

			const mockDeploymentsResponse = {
				data: { resources: [] },
			}

			const axiosGetSpy = vi
				.spyOn(axios, "get")
				.mockResolvedValueOnce(mockModelsResponse)
				.mockResolvedValueOnce(mockDeploymentsResponse)

			// Fetch models to populate cache
			await sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")

			// Verify all models are cached with correct providers
			expect(sapAiCore.getProviderForModel("gpt-4")).toBe("OpenAI")
			expect(sapAiCore.getProviderForModel("claude-3-sonnet")).toBe("Anthropic")
			expect(sapAiCore.getProviderForModel("gemini-pro")).toBe("Google")
			expect(sapAiCore.getProviderForModel("non-existent-model")).toBeUndefined()

			expect(axiosPostSpy).toHaveBeenCalledOnce()
			expect(axiosGetSpy).toHaveBeenCalledTimes(2)
		})
	})

	describe("getProviderForModel", () => {
		it("returns undefined for undefined model ID", () => {
			const provider = sapAiCore.getProviderForModel(undefined)
			expect(provider).toBeUndefined()
		})

		it("returns undefined for non-existent model ID", () => {
			const provider = sapAiCore.getProviderForModel("non-existent-model")
			expect(provider).toBeUndefined()
		})
	})

	describe("Error handling - with mocks", () => {
		beforeEach(() => {
			// Set nock to wild mode to disable interception
			nockBack.setMode("wild")
			vi.resetAllMocks()
		})

		afterEach(() => {
			vi.restoreAllMocks()
			// Reset nock back to lockdown mode
			nockBack.setMode("lockdown")
		})

		it("handles authentication errors gracefully for models", async () => {
			const axiosPostSpy = vi.spyOn(axios, "post").mockRejectedValueOnce(new Error("Authentication failed"))

			await expect(sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")).rejects.toThrow(
				"Failed to authenticate with SAP AI Core",
			)

			expect(axiosPostSpy).toHaveBeenCalledOnce()
		})

		it("handles API errors gracefully for models", async () => {
			// Mock successful authentication
			const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
				data: { access_token: "test-token", expires_in: 3600 },
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			} as AxiosResponse)

			// Mock failed models API call - need to mock both calls since fetchModels makes parallel requests
			const axiosGetSpy = vi.spyOn(axios, "get").mockRejectedValueOnce(new Error("API error"))

			await expect(sapAiCore.getSapAiCoreModels(mockServiceKey, "test-resource-group")).rejects.toThrow(
				"Failed to fetch SAP AI Core models",
			)

			expect(axiosPostSpy).toHaveBeenCalledOnce()
			expect(axiosGetSpy).toHaveBeenCalled()
		})

		it("handles authentication errors gracefully for deployments", async () => {
			const axiosPostSpy = vi.spyOn(axios, "post").mockRejectedValueOnce(new Error("Authentication failed"))

			await expect(sapAiCore.getSapAiCoreDeployments(mockServiceKey, "test-resource-group")).rejects.toThrow(
				"Failed to authenticate with SAP AI Core",
			)

			expect(axiosPostSpy).toHaveBeenCalledOnce()
		})

		it("handles API errors gracefully for deployments", async () => {
			// Mock successful authentication
			const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
				data: { access_token: "test-token", expires_in: 3600 },
				status: 200,
				statusText: "OK",
				headers: {},
				config: {},
			} as AxiosResponse)

			// Mock failed deployments API call
			const axiosGetSpy = vi.spyOn(axios, "get").mockRejectedValueOnce(new Error("API error"))

			await expect(sapAiCore.getSapAiCoreDeployments(mockServiceKey, "test-resource-group")).rejects.toThrow(
				"Failed to fetch SAP AI Core deployments",
			)

			expect(axiosPostSpy).toHaveBeenCalledOnce()
			expect(axiosGetSpy).toHaveBeenCalled()
		})
	})
})
