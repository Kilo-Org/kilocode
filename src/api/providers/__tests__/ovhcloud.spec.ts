// kilocode_change - file added
// npx vitest run src/api/providers/__tests__/ovhcloud.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"

import { OVHcloudAIEndpointsHandler } from "../ovhcloud"
import { ovhCloudAiEndpointsDefaultModelId } from "@roo-code/types"
import { calculateApiCostOpenAI } from "../../../shared/cost"

vitest.mock("openai", () => {
	const createMock = vitest.fn()
	return {
		default: vitest.fn(() => ({ chat: { completions: { create: createMock } } })),
	}
})

const ovhCloudAiEndpointsApiKey = "test-ovhcloud-ai-endpoints-api-key"

describe("OVHcloudAIEndpointsHandler", () => {
	let handler: OVHcloudAIEndpointsHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock TelemetryService to avoid initialization issues
		const mockTelemetryService = {
			captureEvent: vitest.fn(),
		}
		vitest.spyOn(TelemetryService, "hasInstance").mockReturnValue(true)
		vitest.spyOn(TelemetryService, "instance", "get").mockReturnValue(mockTelemetryService as any)

		mockCreate = (OpenAI as unknown as any)().chat.completions.create
		handler = new OVHcloudAIEndpointsHandler({ ovhCloudAiEndpointsApiKey })
	})

	afterEach(() => {
		// Restore TelemetryService mocks
		vitest.restoreAllMocks()
	})

	describe("Initialization", () => {
		it("should configure OpenAI client with correct OVHcloud AI Endpoints base URL", () => {
			new OVHcloudAIEndpointsHandler({ ovhCloudAiEndpointsApiKey })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
				}),
			)
		})

		it("should override base URL if custom endpoint provided", () => {
			const customBaseUrl = "https://custom.endpoints.kepler.ai.cloud.ovh.net/v1"
			new OVHcloudAIEndpointsHandler({ ovhCloudAiEndpointsApiKey, ovhCloudAiEndpointsBaseUrl: customBaseUrl })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://custom.endpoints.kepler.ai.cloud.ovh.net/v1",
				}),
			)
		})

		it("should initialize with the provided API key", () => {
			new OVHcloudAIEndpointsHandler({ ovhCloudAiEndpointsApiKey })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: ovhCloudAiEndpointsApiKey,
				}),
			)
		})

		it("should accept custom model configuration during initialization", () => {
			const customModelId = "gpt-oss-120b"
			const customHandler = new OVHcloudAIEndpointsHandler({
				apiModelId: customModelId,
				ovhCloudAiEndpointsApiKey,
			})
			expect(customHandler).toBeDefined()
		})
	})

	describe("Model Management", () => {
		it("should retrieve default model configuration when none specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(ovhCloudAiEndpointsDefaultModelId)
		})

		it("should retrieve specific model configuration when provided", () => {
			const targetModelId = "gpt-oss-120b"
			const handlerWithModel = new OVHcloudAIEndpointsHandler({
				apiModelId: targetModelId,
				ovhCloudAiEndpointsApiKey,
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(targetModelId)
		})

		it("should provide access to model metadata", () => {
			const model = handler.getModel()
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBeDefined()
		})
	})

	describe("Prompt Completion", () => {
		it("should successfully complete a prompt via OVHcloud API", async () => {
			const mockResponse = "Generated response from OVHcloud AI Endpoints"
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: mockResponse } }],
			})

			const result = await handler.completePrompt("test prompt")
			expect(result).toBe(mockResponse)
		})

		it("should handle API errors gracefully during completion", async () => {
			const errorMessage = "OVHcloud AI Endpoints API error"
			mockCreate.mockRejectedValueOnce(new Error(errorMessage))

			await expect(handler.completePrompt("test prompt")).rejects.toThrow(
				`OVHcloud AI Endpoints completion error: ${errorMessage}`,
			)
		})

		it("should pass correct parameters for prompt completion", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "response" } }],
			})

			await handler.completePrompt("test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: ovhCloudAiEndpointsDefaultModelId,
					messages: expect.arrayContaining([{ role: "user", content: "test prompt" }]),
				}),
			)
		})
	})

	describe("Streaming Message Creation", () => {
		it("should stream text content from OVHcloud AI response", async () => {
			const streamContent = "Streaming response from OVHcloud AI Endpoints"

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						next: vitest
							.fn()
							.mockResolvedValueOnce({
								done: false,
								value: { choices: [{ delta: { content: streamContent } }] },
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				}
			})

			const messageStream = handler.createMessage("system prompt", [])
			const chunk = await messageStream.next()

			expect(chunk.done).toBe(false)
			expect(chunk.value).toEqual({ type: "text", text: streamContent })
		})

		it("should provide token usage information from stream", async () => {
			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						next: vitest
							.fn()
							.mockResolvedValueOnce({
								done: false,
								value: {
									choices: [{ delta: {} }],
									usage: { prompt_tokens: 15, completion_tokens: 25 },
								},
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				}
			})

			const messageStream = handler.createMessage("system prompt", [])
			const chunk = await messageStream.next()
			const info = handler.getModel().info

			expect(chunk.done).toBe(false)
			expect(chunk.value).toEqual({
				type: "usage",
				inputTokens: 15,
				outputTokens: 25,
				totalCost: calculateApiCostOpenAI(info, 15, 25).totalCost || undefined,
			})
		})

		it("should configure streaming with appropriate OVHcloud parameters", async () => {
			const modelId = "gpt-oss-120b"
			const modelInfo = handler.getModel().info
			const customHandler = new OVHcloudAIEndpointsHandler({
				apiModelId: modelId,
				ovhCloudAiEndpointsApiKey,
			})

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				}
			})

			const systemPrompt = "System configuration for OVHcloud AI Endpoints"
			const userMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "User query for OVHcloud AI Endpoints processing" },
			]

			const streamGenerator = customHandler.createMessage(systemPrompt, userMessages)
			await streamGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith({
				model: modelId,
				messages: [{ role: "system", content: systemPrompt }, userMessages[0]],
				stream: true,
				stream_options: { include_usage: true },
			})
		})
	})

	describe("Error Handling", () => {
		it("should handle network errors during streaming", async () => {
			const networkError = new Error("Network connection failed")
			mockCreate.mockRejectedValueOnce(networkError)

			const messageStream = handler.createMessage("system prompt", [])

			await expect(messageStream.next()).rejects.toThrow("Network connection failed")
		})
	})
})
