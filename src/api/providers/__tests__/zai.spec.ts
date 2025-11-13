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

import { zaiCodingDefaultModelId, zaiCodingModels, ZAI_DEFAULT_TEMPERATURE, ModelInfo } from "@roo-code/types"

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
			expect(model.id).toBe(zaiCodingDefaultModelId)
			expect(model.info).toEqual(zaiCodingModels[zaiCodingDefaultModelId])
		})

		it("should return specified international model when valid model is provided", () => {
			const testModelId: keyof typeof zaiCodingModels = "glm-4.6"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(zaiCodingModels[testModelId])
		})

		it("should return GLM-4.6 international model with correct configuration", () => {
			const testModelId: keyof typeof zaiCodingModels = "glm-4.6"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(zaiCodingModels[testModelId])
			expect(model.info.contextWindow).toBe(200_000)
		})

		it("should return GLM-4.5v international model with vision support", () => {
			const testModelId: keyof typeof zaiCodingModels = "glm-4.5v"
			const handlerWithModel = new ZAiHandler({
				apiModelId: testModelId,
				zaiApiKey: "test-zai-api-key",
				zaiApiLine: "international_coding",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(zaiCodingModels[testModelId])
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.maxTokens).toBe(64_000)
			expect(model.info.contextWindow).toBe(64_000)
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
			expect(model.id).toBe(zaiCodingDefaultModelId)
			expect(model.info).toEqual(zaiCodingModels[zaiCodingDefaultModelId])
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
			expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
		})

		it("createMessage should pass correct parameters to Z AI client", async () => {
			const modelId = "glm-4.5"
			const modelInfo: ModelInfo = zaiCodingModels[modelId]
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
		})

		describe("Reasoning functionality", () => {
			it("should include thinking parameter when enableReasoningEffort is true and model supports reasoning in createMessage", async () => {
				const handlerWithReasoning = new ZAiHandler({
					apiModelId: "glm-4.6", // GLM-4.6 has supportsReasoningBinary: true
					zaiApiKey: "test-zai-api-key",
					zaiApiLine: "international_coding",
					enableReasoningEffort: true,
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

				const systemPrompt = "Test system prompt"
				const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message" }]

				const messageGenerator = handlerWithReasoning.createMessage(systemPrompt, messages)
				await messageGenerator.next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.objectContaining({
						thinking: { type: "enabled" },
					}),
					undefined,
				)
			})

			it("should not include thinking parameter when enableReasoningEffort is false in createMessage", async () => {
				const handlerWithoutReasoning = new ZAiHandler({
					apiModelId: "glm-4.6", // GLM-4.6 has supportsReasoningBinary: true
					zaiApiKey: "test-zai-api-key",
					zaiApiLine: "international_coding",
					enableReasoningEffort: false,
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

				const systemPrompt = "Test system prompt"
				const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message" }]

				const messageGenerator = handlerWithoutReasoning.createMessage(systemPrompt, messages)
				await messageGenerator.next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.not.objectContaining({
						thinking: expect.anything(),
					}),
					undefined,
				)
			})

			it("should not include thinking parameter when model does not support reasoning in createMessage", async () => {
				const handlerWithNonReasoningModel = new ZAiHandler({
					apiModelId: "glm-4-32b-0414-128k", // This model doesn't have supportsReasoningBinary: true
					zaiApiKey: "test-zai-api-key",
					zaiApiLine: "international_coding",
					enableReasoningEffort: true,
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

				const systemPrompt = "Test system prompt"
				const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message" }]

				const messageGenerator = handlerWithNonReasoningModel.createMessage(systemPrompt, messages)
				await messageGenerator.next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.not.objectContaining({
						thinking: expect.anything(),
					}),
					undefined,
				)
			})

			it("should include thinking parameter when enableReasoningEffort is true and model supports reasoning in completePrompt", async () => {
				const handlerWithReasoning = new ZAiHandler({
					apiModelId: "glm-4.5", // GLM-4.5 has supportsReasoningBinary: true
					zaiApiKey: "test-zai-api-key",
					zaiApiLine: "international_coding",
					enableReasoningEffort: true,
				})

				const expectedResponse = "This is a test response"
				mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })

				await handlerWithReasoning.completePrompt("test prompt")

				expect(mockCreate).toHaveBeenCalledWith(
					expect.objectContaining({
						thinking: { type: "enabled" },
					}),
				)
			})

			it("should not include thinking parameter when enableReasoningEffort is false in completePrompt", async () => {
				const handlerWithoutReasoning = new ZAiHandler({
					apiModelId: "glm-4.5", // GLM-4.5 has supportsReasoningBinary: true
					zaiApiKey: "test-zai-api-key",
					zaiApiLine: "international_coding",
					enableReasoningEffort: false,
				})

				const expectedResponse = "This is a test response"
				mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })

				await handlerWithoutReasoning.completePrompt("test prompt")

				expect(mockCreate).toHaveBeenCalledWith(
					expect.not.objectContaining({
						thinking: expect.anything(),
					}),
				)
			})
		})
	})
})
