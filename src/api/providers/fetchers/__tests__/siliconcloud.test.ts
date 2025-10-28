// npx vitest run api/providers/fetchers/__tests__/siliconcloud.test.ts

import axios from "axios"
import { getSiliconCloudModels } from "../siliconcloud"
import { ModelRecord } from "../../../../shared/api"

vitest.mock("axios")

describe("getSiliconCloudModels", () => {
	beforeEach(() => {
		vi.mocked(axios.get).mockClear()
	})

	describe("when no API key is provided", () => {
		it("should return empty object", async () => {
			const result = await getSiliconCloudModels(undefined)
			expect(result).toEqual({})
			expect(axios.get).not.toHaveBeenCalled()
		})

		it("should return empty object when API key is empty string", async () => {
			const result = await getSiliconCloudModels("")
			expect(result).toEqual({})
			expect(axios.get).not.toHaveBeenCalled()
		})
	})

	describe("API line configuration", () => {
		it("should use correct base URL for china API line", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			await getSiliconCloudModels("test-key", "china")

			expect(axios.get).toHaveBeenCalledWith("https://api.siliconflow.cn/v1/models", {
				headers: {
					Authorization: "Bearer test-key",
				},
			})
		})

		it("should use correct base URL for china overseas API line", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			await getSiliconCloudModels("test-key", "chinaOverseas")

			expect(axios.get).toHaveBeenCalledWith("https://api-st.siliconflow.cn/v1/models", {
				headers: {
					Authorization: "Bearer test-key",
				},
			})
		})

		it("should use correct base URL for international API line", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			await getSiliconCloudModels("test-key", "international")

			expect(axios.get).toHaveBeenCalledWith("https://api.siliconflow.com/v1/models", {
				headers: {
					Authorization: "Bearer test-key",
				},
			})
		})

		it("should use default china API line when not specified", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			await getSiliconCloudModels("test-key", undefined)

			expect(axios.get).toHaveBeenCalledWith("https://api.siliconflow.cn/v1/models", {
				headers: {
					Authorization: "Bearer test-key",
				},
			})
		})

		it("should return empty object for invalid API line", async () => {
			const result = await getSiliconCloudModels("test-key", "invalid-line")
			expect(result).toEqual({})
			expect(axios.get).not.toHaveBeenCalled()
		})
	})

	describe("successful model fetching", () => {
		it("should fetch and parse multiple models", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
						{
							id: "deepseek-ai/DeepSeek-V3.1-Terminus",
							object: "model",
							created: 1234567890,
							owned_by: "deepseek-ai",
						},
						{
							id: "moonshotai/Kimi-K2-Instruct-0905",
							object: "model",
							created: 1234567890,
							owned_by: "moonshotai",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({
				"zai-org/GLM-4.6": {
					displayName: "zai-org/GLM-4.6",
					contextWindow: 65536,
					supportsPromptCache: false,
				},
				"deepseek-ai/DeepSeek-V3.1-Terminus": {
					displayName: "deepseek-ai/DeepSeek-V3.1-Terminus",
					contextWindow: 65536,
					supportsPromptCache: false,
				},
				"moonshotai/Kimi-K2-Instruct-0905": {
					displayName: "moonshotai/Kimi-K2-Instruct-0905",
					contextWindow: 65536,
					supportsPromptCache: false,
				},
			} as ModelRecord)
		})

		it("should handle single model response", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "zai-org/GLM-4.6",
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "international")

			expect(Object.keys(result)).toHaveLength(1)
			expect(result["zai-org/GLM-4.6"]).toBeDefined()
			expect(result["zai-org/GLM-4.6"]!.displayName).toBe("zai-org/GLM-4.6")
		})

		it("should handle empty models array", async () => {
			const mockResponse = {
				data: {
					data: [],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({})
		})
	})

	describe("custom model info handling", () => {
		it("should merge custom model info when provided", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "custom-model",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const customModelInfo = {
				contextWindow: 131072,
				supportsPromptCache: true,
				displayName: "Custom Model",
			}

			const result = await getSiliconCloudModels("test-key", "china", customModelInfo)

			expect(result["custom-model"]).toEqual({
				displayName: "custom-model", // This overrides the custom displayName
				contextWindow: 131072,
				supportsPromptCache: true,
			})
		})

		it("should use default context window when custom model info has invalid context window", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "test-model",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const customModelInfo = {
				contextWindow: "invalid" as any,
				supportsPromptCache: true,
			}

			const result = await getSiliconCloudModels("test-key", "china", customModelInfo)

			expect(result["test-model"]).toEqual({
				displayName: "test-model",
				contextWindow: 65536, // Default value
				supportsPromptCache: true,
			})
		})

		it("should handle null custom model info", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "test-model",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "china", null)

			expect(result["test-model"]).toEqual({
				displayName: "test-model",
				contextWindow: 65536,
				supportsPromptCache: false,
			})
		})
	})

	describe("error handling", () => {
		it("should handle network errors gracefully", async () => {
			vi.mocked(axios.get).mockRejectedValueOnce(new Error("Network error"))

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({})
		})

		it("should handle API errors gracefully", async () => {
			vi.mocked(axios.get).mockRejectedValueOnce({
				response: {
					status: 401,
					data: { error: "Unauthorized" },
				},
			})

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({})
		})

		it("should handle timeout errors", async () => {
			vi.mocked(axios.get).mockRejectedValueOnce(new Error("Request timeout"))

			const result = await getSiliconCloudModels("test-key", "international")

			expect(result).toEqual({})
		})

		it("should handle malformed response data", async () => {
			vi.mocked(axios.get).mockResolvedValueOnce({ data: null })

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({})
		})

		it("should handle response with missing data field", async () => {
			vi.mocked(axios.get).mockResolvedValueOnce({ data: {} })

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result).toEqual({})
		})

		it("should handle response with invalid model data", async () => {
			vi.mocked(axios.get).mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "valid-model",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
						null, // Invalid model entry
						{
							// Missing required fields
						},
					],
				},
			})

			const result = await getSiliconCloudModels("test-key", "china")

			// Should still process valid models
			expect(result["valid-model"]).toBeDefined()
		})
	})

	describe("authorization headers", () => {
		it("should include authorization header with API key", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "test-model",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			await getSiliconCloudModels("my-secret-api-key", "china")

			expect(axios.get).toHaveBeenCalledWith(expect.any(String), {
				headers: {
					Authorization: "Bearer my-secret-api-key",
				},
			})
		})

		it("should handle empty API key string", async () => {
			const result = await getSiliconCloudModels("", "china")
			expect(result).toEqual({})
			expect(axios.get).not.toHaveBeenCalled()
		})
	})

	describe("model data structure validation", () => {
		it("should handle models with special characters in ID", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "provider/model-with-dashes_and_underscores.v2",
							object: "model",
							created: 1234567890,
							owned_by: "test-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "china")

			expect(result["provider/model-with-dashes_and_underscores.v2"]).toBeDefined()
			expect(result["provider/model-with-dashes_and_underscores.v2"]!.displayName).toBe(
				"provider/model-with-dashes_and_underscores.v2",
			)
		})

		it("should handle models with long IDs", async () => {
			const longModelId = "very-long-provider-name/very-long-model-name-with-multiple-dashes-and-underscores"
			const mockResponse = {
				data: {
					data: [
						{
							id: longModelId,
							object: "model",
							created: 1234567890,
							owned_by: "very-long-provider-name",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValueOnce(mockResponse)

			const result = await getSiliconCloudModels("test-key", "international")

			expect(result[longModelId]).toBeDefined()
		})
	})

	describe("integration scenarios", () => {
		it("should work with different API lines for the same model", async () => {
			const modelId = "zai-org/GLM-4.6"
			const mockResponse = {
				data: {
					data: [
						{
							id: modelId,
							object: "model",
							created: 1234567890,
							owned_by: "zai-org",
						},
					],
				},
			}
			vi.mocked(axios.get).mockResolvedValue(mockResponse)

			const chinaResult = await getSiliconCloudModels("test-key", "china")
			const internationalResult = await getSiliconCloudModels("test-key", "international")

			// Same model should be fetched from both APIs
			expect(chinaResult[modelId]).toBeDefined()
			expect(internationalResult[modelId]).toBeDefined()

			// But API calls should go to different endpoints
			expect(axios.get).toHaveBeenCalledWith("https://api.siliconflow.cn/v1/models", expect.any(Object))
			expect(axios.get).toHaveBeenCalledWith("https://api.siliconflow.com/v1/models", expect.any(Object))
		})
	})
})
