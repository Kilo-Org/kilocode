// npx vitest run src/api/providers/__tests__/zai.spec.ts

// kilocode_change start
vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn().mockReturnValue({
			get: vitest.fn().mockReturnValue(600), // Default timeout in seconds
		}),
	},
}))
// kilocode_change end

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	type InternationalZAiModelId,
	type MainlandZAiModelId,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	internationalZAiModels,
	mainlandZAiModels,
	ZAI_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import { ZAiHandler } from "../zai"

vitest.mock("openai", () => {
	const createMock = vitest.fn()
	return {
		default: vitest.fn(() => ({ chat: { completions: { create: createMock } } })),
	}
})

describe("ZAiHandler", () => {
	let handler: ZAiHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()
		mockCreate = (OpenAI as unknown as any)().chat.completions.create
	})

	describe("International Z AI", () => {
		beforeEach(() => {
			handler = new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_coding" })
		})

		it("should use the correct international Z AI base URL", () => {
			new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_coding" })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.z.ai/api/coding/paas/v4",
				}),
			)
		})

		it("should use the provided API key for international", () => {
			const zaiApiKey = "test-zai-api-key"
			new ZAiHandler({ zaiApiKey, zaiApiLine: "international_coding" })
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: zaiApiKey }))
		})

		it("should return international default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(internationalZAiDefaultModelId)
			expect(model.info).toEqual(internationalZAiModels[internationalZAiDefaultModelId])
		})

		it("should return specified international model when valid model is provided", () => {
			const testModelId: InternationalZAiModelId = "glm-4.5-air"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(internationalZAiModels[testModelId])
		})

		it("should return GLM-4.6 international model with correct configuration", () => {
			const testModelId: InternationalZAiModelId = "glm-4.6"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(internationalZAiModels[testModelId])
			expect(model.info.contextWindow).toBe(200_000)
		})

		it("should return GLM-4.5v international model with vision support", () => {
			const testModelId: InternationalZAiModelId = "glm-4.5v"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(internationalZAiModels[testModelId])
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.contextWindow).toBe(131_072)
		})
	})

	describe("China Z AI", () => {
		beforeEach(() => {
			handler = new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "china_coding" })
		})

		it("should use the correct China Z AI base URL", () => {
			new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "china_coding" })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: "https://open.bigmodel.cn/api/coding/paas/v4" }),
			)
		})

		it("should use the provided API key for China", () => {
			const zaiApiKey = "test-zai-api-key"
			new ZAiHandler({ zaiApiKey, zaiApiLine: "china_coding" })
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: zaiApiKey }))
		})

		it("should return China default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mainlandZAiDefaultModelId)
			expect(model.info).toEqual(mainlandZAiModels[mainlandZAiDefaultModelId])
		})

		it("should return specified China model when valid model is provided", () => {
			const testModelId: MainlandZAiModelId = "glm-4.5-air"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "china_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(mainlandZAiModels[testModelId])
		})

		it("should return GLM-4.6 China model with correct configuration", () => {
			const testModelId: MainlandZAiModelId = "glm-4.6"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "china_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(mainlandZAiModels[testModelId])
			expect(model.info.contextWindow).toBe(204_800)
		})

		it("should return GLM-4.5v China model with vision support", () => {
			const testModelId: MainlandZAiModelId = "glm-4.5v"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "china_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(mainlandZAiModels[testModelId])
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.contextWindow).toBe(131_072)
		})
	})

	describe("International API", () => {
		beforeEach(() => {
			handler = new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_api" })
		})

		it("should use the correct international API base URL", () => {
			new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_api" })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.z.ai/api/paas/v4",
				}),
			)
		})

		it("should use the provided API key for international API", () => {
			const zaiApiKey = "test-zai-api-key"
			new ZAiHandler({ zaiApiKey, zaiApiLine: "international_api" })
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: zaiApiKey }))
		})

		it("should return international default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(internationalZAiDefaultModelId)
			expect(model.info).toEqual(internationalZAiModels[internationalZAiDefaultModelId])
		})

		it("should return specified international model when valid model is provided", () => {
			const testModelId: InternationalZAiModelId = "glm-4.5-air"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_api",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(internationalZAiModels[testModelId])
		})
	})

	describe("China API", () => {
		beforeEach(() => {
			handler = new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "china_api" })
		})

		it("should use the correct China API base URL", () => {
			new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "china_api" })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://open.bigmodel.cn/api/paas/v4",
				}),
			)
		})

		it("should use the provided API key for China API", () => {
			const zaiApiKey = "test-zai-api-key"
			new ZAiHandler({ zaiApiKey, zaiApiLine: "china_api" })
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: zaiApiKey }))
		})

		it("should return China default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mainlandZAiDefaultModelId)
			expect(model.info).toEqual(mainlandZAiModels[mainlandZAiDefaultModelId])
		})

		it("should return specified China model when valid model is provided", () => {
			const testModelId: MainlandZAiModelId = "glm-4.5-air"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "china_api",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(mainlandZAiModels[testModelId])
		})
	})

	describe("Default behavior", () => {
		it("should default to international when no zaiApiLine is specified", () => {
			const handlerDefault = new ZAiHandler({ zaiApiKey: "test-zai-api-key" })
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.z.ai/api/coding/paas/v4",
				}),
			)

			const model = handlerDefault.getModel()
			expect(model.id).toBe(internationalZAiDefaultModelId)
			expect(model.info).toEqual(internationalZAiModels[internationalZAiDefaultModelId])
		})

		it("should use 'not-provided' as default API key when none is specified", () => {
			new ZAiHandler({ zaiApiLine: "international_coding" })
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "not-provided" }))
		})
	})

	describe("API Methods", () => {
		beforeEach(() => {
			handler = new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_coding" })
		})

		it("completePrompt method should return text from Z AI API", async () => {
			const expectedResponse = "This is a test response from Z AI"
			mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
			const result = await handler.completePrompt("test prompt")
			expect(result).toBe(expectedResponse)
		})

		it("should handle errors in completePrompt", async () => {
			const errorMessage = "Z AI API error"
			mockCreate.mockRejectedValueOnce(new Error(errorMessage))
			await expect(handler.completePrompt("test prompt")).rejects.toThrow(
				`Z.ai completion error: ${errorMessage}`,
			)
		})

		it("createMessage should yield text content from stream", async () => {
			const testContent = "This is test content from Z AI stream"

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						next: vitest
							.fn()
							.mockResolvedValueOnce({
								done: false,
								value: { choices: [{ delta: { content: testContent } }] },
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				}
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "text", text: testContent })
		})

		it("createMessage should yield usage data from stream", async () => {
			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						next: vitest
							.fn()
							.mockResolvedValueOnce({
								done: false,
								value: {
									choices: [{ delta: {} }],
									usage: { prompt_tokens: 10, completion_tokens: 20 },
								},
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				}
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toMatchObject({ type: "usage", inputTokens: 10, outputTokens: 20 })
		})

		it("createMessage should pass correct parameters to Z AI client", async () => {
			const modelId: InternationalZAiModelId = "glm-4.5"
			const modelInfo = internationalZAiModels[modelId]
			const handlerWithModel = new ZAiHandler({
				apiModelId: modelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
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

			const systemPrompt = "Test system prompt for Z AI"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Z AI" }]

			const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
			await messageGenerator.next()

			// Centralized 20% cap should apply to OpenAI-compatible providers like Z AI
			const expectedMaxTokens = Math.min(modelInfo.maxTokens, Math.ceil(modelInfo.contextWindow * 0.2))

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: modelId,
					max_tokens: expectedMaxTokens,
					temperature: ZAI_DEFAULT_TEMPERATURE,
					messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
					stream: true,
					stream_options: { include_usage: true },
				}),
				undefined,
			)
		})
	})
})
