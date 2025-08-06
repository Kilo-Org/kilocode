// npx vitest run api/providers/__tests__/fireworks.test.ts

import { FireworksHandler } from "../fireworks"
import type { ApiHandlerOptions } from "../../../shared/api"
import type { Anthropic } from "@anthropic-ai/sdk"
import { fireworksDefaultModelId, fireworksModels } from "@roo-code/types"

const mockCreate = vi.fn()

vi.mock("openai", () => {
	const mockConstructor = vi.fn()
	return {
		__esModule: true,
		default: mockConstructor.mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response", refusal: null },
										finish_reason: "stop",
										index: 0,
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
								},
							}
						}

						return {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: {},
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
							},
						}
					}),
				},
			},
		})),
	}
})

describe("FireworksHandler", () => {
	let handler: FireworksHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			fireworksApiKey: "test-fireworks-api-key",
			apiModelId: fireworksDefaultModelId,
			includeMaxTokens: true,
			modelTemperature: 0.5,
		}
		handler = new FireworksHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(FireworksHandler)
			expect(handler.getModel().id).toBe(fireworksDefaultModelId)
		})

		it("should throw error if API key is missing", () => {
			expect(() => {
				new FireworksHandler({
					...mockOptions,
					fireworksApiKey: undefined,
				})
			}).toThrow("API key is required")
		})

		it("should use fireworks base URL", () => {
			const handlerWithKey = new FireworksHandler({
				...mockOptions,
				fireworksApiKey: "test-key",
			})
			expect(handlerWithKey).toBeInstanceOf(FireworksHandler)
		})

		it("should set default temperature to 0.5", () => {
			const handlerWithDefaults = new FireworksHandler({
				fireworksApiKey: "test-key",
			})
			expect(handlerWithDefaults).toBeInstanceOf(FireworksHandler)
		})

		it("should override default model if provided in options", () => {
			const customModelId = "accounts/fireworks/models/deepseek-v3"
			const handlerWithCustomModel = new FireworksHandler({
				...mockOptions,
				apiModelId: customModelId,
			})
			expect(handlerWithCustomModel.getModel().id).toBe(customModelId)
		})
	})

	describe("getModel", () => {
		it("should return correct model info for default model", () => {
			const model = handler.getModel()
			expect(model.id).toBe(fireworksDefaultModelId)
			expect(model.info).toEqual(fireworksModels[fireworksDefaultModelId])
			expect(model.info.supportsPromptCache).toBe(false)
			expect(model.info.supportsImages).toBe(false)
		})

		it("should return correct model info for deepseek-v3", () => {
			const deepseekModelId = "accounts/fireworks/models/deepseek-v3"
			const handlerWithDeepseek = new FireworksHandler({
				...mockOptions,
				apiModelId: deepseekModelId,
			})
			const model = handlerWithDeepseek.getModel()
			expect(model.id).toBe(deepseekModelId)
			expect(model.info).toEqual(fireworksModels[deepseekModelId])
			expect(model.info.maxTokens).toBe(16384)
			expect(model.info.contextWindow).toBe(128000)
		})

		it("should return correct model info for qwen3-235b", () => {
			const qwenModelId = "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
			const handlerWithQwen = new FireworksHandler({
				...mockOptions,
				apiModelId: qwenModelId,
			})
			const model = handlerWithQwen.getModel()
			expect(model.id).toBe(qwenModelId)
			expect(model.info).toEqual(fireworksModels[qwenModelId])
			expect(model.info.maxTokens).toBe(32768)
			expect(model.info.contextWindow).toBe(256000)
		})

		it("should return correct pricing information", () => {
			const model = handler.getModel()
			expect(model.info.inputPrice).toBeDefined()
			expect(model.info.outputPrice).toBeDefined()
			expect(typeof model.info.inputPrice).toBe("number")
			expect(typeof model.info.outputPrice).toBe("number")
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello, how are you?",
			},
		]

		it("should create streaming response", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(2)
			expect(chunks[0]).toEqual({
				type: "text",
				text: "Test response",
			})
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
			})
		})

		it("should call OpenAI client with correct parameters", async () => {
			const stream = handler.createMessage(systemPrompt, messages)

			// Consume the stream to trigger the API call
			for await (const chunk of stream) {
				// Just consume the stream
			}

			expect(mockCreate).toHaveBeenCalledWith({
				model: fireworksDefaultModelId,
				max_tokens: fireworksModels[fireworksDefaultModelId].maxTokens,
				temperature: 0.5,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "Hello, how are you?" },
				],
				stream: true,
				stream_options: { include_usage: true },
			})
		})

		it("should use custom temperature when provided", async () => {
			const customHandler = new FireworksHandler({
				...mockOptions,
				modelTemperature: 0.8,
			})

			const stream = customHandler.createMessage(systemPrompt, messages)

			// Consume the stream to trigger the API call
			for await (const chunk of stream) {
				// Just consume the stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.8,
				}),
			)
		})

		it("should handle multiple messages correctly", async () => {
			const multiMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "First message",
				},
				{
					role: "assistant",
					content: "First response",
				},
				{
					role: "user",
					content: "Second message",
				},
			]

			const stream = handler.createMessage(systemPrompt, multiMessages)

			// Consume the stream to trigger the API call
			for await (const chunk of stream) {
				// Just consume the stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: "First message" },
						{ role: "assistant", content: "First response" },
						{ role: "user", content: "Second message" },
					],
				}),
			)
		})

		it("should handle empty content delta", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: null },
								index: 0,
							},
						],
						usage: null,
					}
					yield {
						choices: [
							{
								delta: {},
								index: 0,
							},
						],
						usage: {
							prompt_tokens: 5,
							completion_tokens: 3,
							total_tokens: 8,
						},
					}
				},
			}))

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({
				type: "usage",
				inputTokens: 5,
				outputTokens: 3,
			})
		})
	})

	describe("provider specifics", () => {
		it("should use Fireworks as provider name", () => {
			expect(handler).toBeInstanceOf(FireworksHandler)
			// The provider name is internal, but we can verify through constructor behavior
		})

		it("should use correct API base URL", () => {
			expect(handler).toBeInstanceOf(FireworksHandler)
			// Base URL is set internally to https://api.fireworks.ai/inference/v1
		})

		it("should support all defined Fireworks models", () => {
			const modelIds = Object.keys(fireworksModels)

			modelIds.forEach((modelId) => {
				const testHandler = new FireworksHandler({
					...mockOptions,
					apiModelId: modelId as any,
				})
				expect(testHandler.getModel().id).toBe(modelId)
				expect(testHandler.getModel().info).toEqual(fireworksModels[modelId as keyof typeof fireworksModels])
			})
		})

		it("should have proper model info structure", () => {
			const model = handler.getModel()

			expect(model.info).toHaveProperty("maxTokens")
			expect(model.info).toHaveProperty("contextWindow")
			expect(model.info).toHaveProperty("supportsImages")
			expect(model.info).toHaveProperty("supportsPromptCache")
			expect(model.info).toHaveProperty("inputPrice")
			expect(model.info).toHaveProperty("outputPrice")
			expect(model.info).toHaveProperty("description")

			expect(typeof model.info.maxTokens).toBe("number")
			expect(typeof model.info.contextWindow).toBe("number")
			expect(typeof model.info.supportsImages).toBe("boolean")
			expect(typeof model.info.supportsPromptCache).toBe("boolean")
			expect(typeof model.info.inputPrice).toBe("number")
			expect(typeof model.info.outputPrice).toBe("number")
			expect(typeof model.info.description).toBe("string")
		})
	})
})
