// kilocode_change - new file
// npx vitest run api/providers/__tests__/sap-ai-core.spec.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
// Import after mocks are set up
import { SapAiCoreHandler } from "../sap-ai-core"
import { ApiHandlerOptions } from "../../../shared/api"
import { getProviderForModel, getSapAiCoreModels } from "../fetchers/sap-ai-core"
import { OrchestrationClient } from "@sap-ai-sdk/orchestration"
import { AzureOpenAiChatClient } from "@sap-ai-sdk/foundation-models"

// Mock SAP AI SDK modules
vi.mock("@sap-ai-sdk/orchestration", () => ({
	OrchestrationClient: vi.fn(),
}))

vi.mock("@sap-ai-sdk/foundation-models", () => ({
	AzureOpenAiChatClient: vi.fn(),
}))

// Mock the SAP AI Core fetcher
vi.mock("../fetchers/sap-ai-core", () => ({
	getSapAiCoreModels: vi.fn(),
	getProviderForModel: vi.fn(),
}))

describe("SapAiCoreHandler", () => {
	let handler: SapAiCoreHandler
	let mockOptions: ApiHandlerOptions

	// Mock functions
	const mockStreamToContentStream = vi.fn()
	const mockGetTokenUsage = vi.fn()
	const mockGetContent = vi.fn()
	const mockChatCompletion = vi.fn()
	const mockStream = vi.fn()
	const mockRun = vi.fn()

	beforeEach(() => {
		const testServiceKey = {
			clientid: "test-client-id",
			clientsecret: "test-client-secret",
			url: "https://test-auth-url.com",
			serviceurls: {
				AI_API_URL: "https://test-base-url.com",
			},
		}

		mockOptions = {
			sapAiCoreServiceKey: JSON.stringify(testServiceKey),
			sapAiCoreResourceGroup: "test-resource-group",
			sapAiCoreModelId: "gpt-4o-mini",
			sapAiCoreUseOrchestration: false,
		}

		// Reset all mocks
		vi.clearAllMocks()

		// Setup default mock responses - now returns ModelInfo directly
		vi.mocked(getSapAiCoreModels).mockResolvedValue({
			"gpt-4o-mini": {
				contextWindow: 32768,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: 0.00015,
				outputPrice: 0.0006,
				description: "GPT-4o mini model",
				displayName: "GPT-4o Mini",
				preferredIndex: undefined,
			},
		})

		// Setup mock for getProviderForModel to return "OpenAI" by default
		vi.mocked(getProviderForModel).mockReturnValue("OpenAI")

		// Setup mock stream responses
		mockStreamToContentStream.mockImplementation(async function* () {
			yield "Test response from SAP AI Core"
		})

		mockGetTokenUsage.mockReturnValue({
			prompt_tokens: 10,
			completion_tokens: 15,
			total_tokens: 25,
		})

		mockGetContent.mockReturnValue("Test response from SAP AI Core")

		const mockStreamResponse = {
			stream: {
				toContentStream: mockStreamToContentStream,
			},
			getTokenUsage: mockGetTokenUsage,
		}

		const mockRunResponse = {
			stream: {
				toContentStream: mockStreamToContentStream,
			},
			getTokenUsage: mockGetTokenUsage,
			getContent: mockGetContent,
		}

		mockStream.mockResolvedValue(mockStreamResponse)
		mockRun.mockResolvedValue(mockRunResponse)
		mockChatCompletion.mockResolvedValue(mockRunResponse)

		// Setup mock constructors
		const mockOrchestrationClient = {
			stream: mockStream,
			chatCompletion: mockChatCompletion,
		}

		const mockAzureOpenAiChatClient = {
			stream: mockStream,
			run: mockRun,
		}

		vi.mocked(OrchestrationClient).mockImplementation(() => mockOrchestrationClient as any)
		vi.mocked(AzureOpenAiChatClient).mockImplementation(() => mockAzureOpenAiChatClient as any)

		handler = new SapAiCoreHandler(mockOptions)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		// Clean up environment variable
		delete process.env["AICORE_SERVICE_KEY"]
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(SapAiCoreHandler)
			expect(handler.getModel().id).toBe(mockOptions.sapAiCoreModelId)
		})

		it("should default to foundation backend when useOrchestration is false", () => {
			const foundationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: false,
			})
			expect(foundationHandler).toBeInstanceOf(SapAiCoreHandler)
		})

		it("should use orchestration backend when useOrchestration is true", () => {
			const orchestrationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
			})
			expect(orchestrationHandler).toBeInstanceOf(SapAiCoreHandler)
		})

		it("should default useOrchestration to false when not specified", () => {
			const defaultHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: undefined,
			})
			expect(defaultHandler).toBeInstanceOf(SapAiCoreHandler)
		})
	})

	describe("getModel", () => {
		it("should return model info for foundation models", () => {
			const model = handler.getModel()
			expect(model.id).toBe("gpt-4o-mini")
			expect(model.info).toBeDefined()
			expect(model.info?.contextWindow).toBe(32768)
			expect(model.info?.supportsImages).toBe(false)
			expect(model.info?.inputPrice).toBe(0.00015)
			expect(model.info?.outputPrice).toBe(0.0006)
		})

		it("should return model info for orchestration models", async () => {
			vi.mocked(getSapAiCoreModels).mockResolvedValue({
				"gpt-4o-orchestration": {
					contextWindow: 32768,
					supportsImages: true,
					supportsPromptCache: false,
					inputPrice: 0.005,
					outputPrice: 0.015,
					description: "GPT-4o orchestration model",
					displayName: "GPT-4o Orchestration",
					preferredIndex: undefined,
				},
			})

			const orchestrationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreModelId: "gpt-4o-orchestration",
				sapAiCoreUseOrchestration: true,
			})

			// Wait for initialization to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			const model = orchestrationHandler.getModel()
			expect(model.id).toBe("gpt-4o-orchestration")
			expect(model.info?.supportsImages).toBe(true)
			expect(model.info?.inputPrice).toBe(0.005)
		})
	})

	describe("environment setup", () => {
		it("should set up AICORE_SERVICE_KEY environment variable", async () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello!",
				},
			]

			// Consume the stream to trigger environment setup
			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-1" })
			await stream.next()

			expect(process.env["AICORE_SERVICE_KEY"]).toBeDefined()
			const serviceKey = JSON.parse(process.env["AICORE_SERVICE_KEY"]!)
			expect(serviceKey).toEqual({
				clientid: "test-client-id",
				clientsecret: "test-client-secret",
				url: "https://test-auth-url.com",
				serviceurls: {
					AI_API_URL: "https://test-base-url.com",
				},
			})
		})

		it("should only set up environment once", async () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello!",
				},
			]

			// First call
			const stream1 = handler.createMessage(systemPrompt, messages, { taskId: "test-task-2" })
			await stream1.next()

			const firstServiceKey = process.env["AICORE_SERVICE_KEY"]

			// Second call
			const stream2 = handler.createMessage(systemPrompt, messages, { taskId: "test-task-3" })
			await stream2.next()

			const secondServiceKey = process.env["AICORE_SERVICE_KEY"]

			expect(firstServiceKey).toBe(secondServiceKey)
		})
	})

	describe("createMessage with Foundation backend", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle streaming responses successfully", async () => {
			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-4" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")

			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response from SAP AI Core")

			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 15,
				cacheWriteTokens: undefined,
				cacheReadTokens: undefined,
			})

			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})

		it("should handle complex message content", async () => {
			const complexMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What is in this image?",
						},
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/jpeg",
								data: "base64data",
							},
						},
					],
				},
			]

			const stream = handler.createMessage(systemPrompt, complexMessages, { taskId: "test-task-5" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})

		it("should handle temperature parameter", async () => {
			const handlerWithTemp = new SapAiCoreHandler({
				...mockOptions,
				modelTemperature: 0.7,
			})

			const stream = handlerWithTemp.createMessage(systemPrompt, messages, { taskId: "test-task-6" })
			await stream.next()

			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})

		it("should handle max tokens parameter", async () => {
			const handlerWithMaxTokens = new SapAiCoreHandler({
				...mockOptions,
				modelMaxTokens: 2048,
			})

			const stream = handlerWithMaxTokens.createMessage(systemPrompt, messages, { taskId: "test-task-7" })
			await stream.next()

			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})

		it("should handle deployment ID parameter", async () => {
			const handlerWithDeployment = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreDeploymentId: "test-deployment-123",
			})

			const stream = handlerWithDeployment.createMessage(systemPrompt, messages, { taskId: "test-task-8" })
			await stream.next()

			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})
	})

	describe("createMessage with Orchestration backend", () => {
		let orchestrationHandler: SapAiCoreHandler

		beforeEach(() => {
			orchestrationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
			})
		})

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle streaming responses successfully", async () => {
			const stream = orchestrationHandler.createMessage(systemPrompt, messages, { taskId: "test-task-9" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")

			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response from SAP AI Core")

			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 15,
				cacheWriteTokens: undefined,
				cacheReadTokens: undefined,
			})

			expect(vi.mocked(OrchestrationClient)).toHaveBeenCalled()
		})

		it("should handle temperature parameter", async () => {
			const orchestrationHandlerWithTemp = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
				modelTemperature: 0.8,
			})

			const stream = orchestrationHandlerWithTemp.createMessage(systemPrompt, messages, {
				taskId: "test-task-10",
			})
			await stream.next()

			expect(vi.mocked(OrchestrationClient)).toHaveBeenCalled()
		})

		it("should handle max tokens parameter", async () => {
			const orchestrationHandlerWithMaxTokens = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
				modelMaxTokens: 4096,
			})

			const stream = orchestrationHandlerWithMaxTokens.createMessage(systemPrompt, messages, {
				taskId: "test-task-11",
			})
			await stream.next()

			expect(vi.mocked(OrchestrationClient)).toHaveBeenCalled()
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully with foundation backend", async () => {
			const result = await handler.completePrompt("What is the weather like?")

			expect(result).toBe("Test response from SAP AI Core")
			expect(vi.mocked(AzureOpenAiChatClient)).toHaveBeenCalled()
		})

		it("should complete prompt successfully with orchestration backend", async () => {
			const orchestrationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
			})

			const result = await orchestrationHandler.completePrompt("What is the weather like?")

			expect(result).toBe("Test response from SAP AI Core")
			expect(vi.mocked(OrchestrationClient)).toHaveBeenCalled()
		})

		it("should handle empty response", async () => {
			mockGetContent.mockReturnValue("")
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle API errors", async () => {
			mockRun.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"SAP AI Core completion error: API Error",
			)
		})
	})

	describe("error handling", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle streaming errors in foundation backend", async () => {
			// Mock the stream method to reject with an error
			mockStream.mockRejectedValueOnce(new Error("Foundation API Error"))

			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-12" })

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("Foundation API Error")
		})

		it("should handle streaming errors in orchestration backend", async () => {
			const orchestrationHandler = new SapAiCoreHandler({
				...mockOptions,
				sapAiCoreUseOrchestration: true,
			})

			mockStream.mockRejectedValueOnce(new Error("Orchestration API Error"))

			const stream = orchestrationHandler.createMessage(systemPrompt, messages, { taskId: "test-task-13" })

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("Orchestration API Error")
		})

		it("should handle unsupported provider in foundation backend", () => {
			// Since we now only store ModelInfo and assume OpenAI for foundation models,
			// this test is no longer relevant as provider detection is simplified.
			// We'll keep it but expect it to not throw since we always assume OpenAI
			vi.mocked(getSapAiCoreModels).mockResolvedValue({
				"anthropic-model": {
					contextWindow: 32768,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 0.001,
					outputPrice: 0.003,
					description: "Anthropic model",
					displayName: "Anthropic Model",
					preferredIndex: undefined,
				},
			})

			// This should not throw anymore since we assume OpenAI for all foundation models
			expect(
				() =>
					new SapAiCoreHandler({
						...mockOptions,
						sapAiCoreModelId: "anthropic-model",
						sapAiCoreUseOrchestration: false,
					}),
			).not.toThrow()
		})
	})

	describe("backend routing", () => {
		it("should route to OpenAI foundation backend for OpenAI models", () => {
			// This should not throw since OpenAI is supported
			expect(
				() =>
					new SapAiCoreHandler({
						...mockOptions,
						sapAiCoreUseOrchestration: false,
					}),
			).not.toThrow()
		})

		it("should not throw for any foundation models (simplified provider handling)", () => {
			vi.mocked(getSapAiCoreModels).mockResolvedValue({
				"google-model": {
					contextWindow: 32768,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 0.001,
					outputPrice: 0.003,
					description: "Google model",
					displayName: "Google Model",
					preferredIndex: undefined,
				},
			})

			// Should not throw since we simplified provider detection
			expect(
				() =>
					new SapAiCoreHandler({
						...mockOptions,
						sapAiCoreModelId: "google-model",
						sapAiCoreUseOrchestration: false,
					}),
			).not.toThrow()
		})

		it("should not throw for Amazon foundation models (simplified provider handling)", () => {
			vi.mocked(getSapAiCoreModels).mockResolvedValue({
				"amazon-model": {
					contextWindow: 32768,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 0.001,
					outputPrice: 0.003,
					description: "Amazon model",
					displayName: "Amazon Model",
					preferredIndex: undefined,
				},
			})

			// Should not throw since we simplified provider detection
			expect(
				() =>
					new SapAiCoreHandler({
						...mockOptions,
						sapAiCoreModelId: "amazon-model",
						sapAiCoreUseOrchestration: false,
					}),
			).not.toThrow()
		})

		it("should not throw for Mistral foundation models (simplified provider handling)", () => {
			vi.mocked(getSapAiCoreModels).mockResolvedValue({
				"mistral-model": {
					contextWindow: 32768,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 0.001,
					outputPrice: 0.003,
					description: "Mistral model",
					displayName: "Mistral Model",
					preferredIndex: undefined,
				},
			})

			// Should not throw since we simplified provider detection
			expect(
				() =>
					new SapAiCoreHandler({
						...mockOptions,
						sapAiCoreModelId: "mistral-model",
						sapAiCoreUseOrchestration: false,
					}),
			).not.toThrow()
		})
	})

	describe("token usage handling", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle missing token usage gracefully", async () => {
			mockGetTokenUsage.mockReturnValue(null)

			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-14" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(0)
		})

		it("should handle partial token usage", async () => {
			mockGetTokenUsage.mockReturnValue({
				prompt_tokens: 5,
				// Missing completion_tokens
			})

			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-15" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 5,
				outputTokens: 0,
				cacheWriteTokens: undefined,
				cacheReadTokens: undefined,
			})
		})

		it("should handle cache token usage", async () => {
			mockGetTokenUsage.mockReturnValue({
				prompt_tokens: 10,
				completion_tokens: 15,
				cache_creation_input_tokens: 5,
				cache_read_input_tokens: 3,
			})

			const stream = handler.createMessage(systemPrompt, messages, { taskId: "test-task-16" })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 15,
				cacheWriteTokens: 5,
				cacheReadTokens: 3,
			})
		})
	})
})
