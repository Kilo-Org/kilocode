// kilocode_change: file added
// npx vitest run api/providers/__tests__/synthetic.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type SyntheticModelId, syntheticDefaultModelId, syntheticModels } from "@roo-code/types"

import { SyntheticHandler } from "../synthetic"

// Create mock functions
const mockCreate = vi.fn()

// Mock OpenAI module
vi.mock("openai", () => ({
	default: vi.fn(() => ({
		chat: {
			completions: {
				create: mockCreate,
			},
		},
	})),
}))

// Mock model cache
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn(),
}))

// Import the mocked function after mock setup
const { getModels: mockGetModels } = await import("../fetchers/modelCache")

describe("SyntheticHandler", () => {
	let handler: SyntheticHandler

	beforeEach(() => {
		vi.clearAllMocks()
		// Mock getModels to return the static models
		vi.mocked(mockGetModels).mockResolvedValue(syntheticModels)
		// Set up default mock implementation
		mockCreate.mockImplementation(async () => ({
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
		}))
		handler = new SyntheticHandler({ syntheticApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct synthetic base URL", () => {
		new SyntheticHandler({ syntheticApiKey: "test-synthetic-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://api.synthetic.new/openai/v1" }))
	})

	it("should use custom base URL when syntheticBaseUrl is provided", () => {
		const customBaseUrl = "https://custom.synthetic.example.com/v1"
		new SyntheticHandler({ syntheticApiKey: "test-synthetic-api-key", syntheticBaseUrl: customBaseUrl })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: customBaseUrl }))
	})

	it("should use default base URL when syntheticBaseUrl is empty string", () => {
		new SyntheticHandler({ syntheticApiKey: "test-synthetic-api-key", syntheticBaseUrl: "" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://api.synthetic.new/openai/v1" }))
	})

	it("should use the provided API key", () => {
		const syntheticApiKey = "test-synthetic-api-key"
		new SyntheticHandler({ syntheticApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: syntheticApiKey }))
	})

	it("should throw error when API key is not provided", () => {
		expect(() => new SyntheticHandler({})).toThrow("API key is required")
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(syntheticDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(syntheticModels[syntheticDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
		const handlerWithModel = new SyntheticHandler({
			apiModelId: testModelId,
			syntheticApiKey: "test-synthetic-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(syntheticModels[testModelId]))
	})

	it("should return GLM model with correct configuration", () => {
		const testModelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
		const handlerWithModel = new SyntheticHandler({
			apiModelId: testModelId,
			syntheticApiKey: "test-synthetic-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 128000,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.55,
				outputPrice: 2.19,
			}),
		)
	})

	it("completePrompt method should return text from synthetic API", async () => {
		const expectedResponse = "This is a test response from synthetic"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "synthetic API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(errorMessage)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from synthetic stream"

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
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
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 20 } },
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: undefined,
			cacheReadTokens: undefined,
			totalCost: expect.any(Number),
		})
	})

	it("createMessage should pass correct parameters to synthetic client", async () => {
		const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
		const modelInfo = syntheticModels[modelId]
		const handlerWithModel = new SyntheticHandler({
			apiModelId: modelId,
			syntheticApiKey: "test-synthetic-api-key",
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

		const systemPrompt = "Test system prompt for synthetic"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for synthetic" }]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				temperature: 0.5,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
				max_tokens: expect.any(Number),
			}),
		)
	})

	it("should handle empty response in completePrompt", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe("")
	})

	it("should handle missing choices in completePrompt", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe("")
	})

	it("createMessage should handle stream with multiple chunks", async () => {
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { content: "Hello" },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: { content: " world" },
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
						completion_tokens: 10,
						total_tokens: 15,
					},
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "text", text: "Hello" },
			{ type: "text", text: " world" },
			{
				type: "usage",
				inputTokens: 5,
				outputTokens: 10,
				cacheWriteTokens: undefined,
				cacheReadTokens: undefined,
				totalCost: expect.any(Number),
			},
		])
	})

	describe("includeMaxTokens and modelMaxTokens", () => {
		const SYNTHETIC_DEFAULT_MAX_TOKENS = 8192

		it("should include max_tokens with default value of 8192 when includeMaxTokens not set", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: SYNTHETIC_DEFAULT_MAX_TOKENS,
				}),
			)
		})

		it("should include max_tokens with default value of 8192 when includeMaxTokens is true", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: true,
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: SYNTHETIC_DEFAULT_MAX_TOKENS,
				}),
			)
		})

		it("should NOT include max_tokens when includeMaxTokens is false", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: false,
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBeUndefined()
		})

		it("should use modelMaxTokens when provided and includeMaxTokens is true", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const customMaxTokens = 4096
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: true,
				modelMaxTokens: customMaxTokens,
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: customMaxTokens,
				}),
			)
		})

		it("should use modelMaxTokens when provided (includeMaxTokens defaults to true)", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const customMaxTokens = 8192
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				modelMaxTokens: customMaxTokens,
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: customMaxTokens,
				}),
			)
		})

		it("should NOT use modelMaxTokens when includeMaxTokens is false", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const customMaxTokens = 4096
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: false,
				modelMaxTokens: customMaxTokens,
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}))

			const stream = handlerWithModel.createMessage("system prompt", [])
			await stream.next()

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBeUndefined()
		})

		it("completePrompt should respect includeMaxTokens setting", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: false,
			})

			mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "response" } }] })

			await handlerWithModel.completePrompt("test prompt")

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBeUndefined()
		})

		it("completePrompt should use modelMaxTokens when provided", async () => {
			const modelId: SyntheticModelId = "hf:zai-org/GLM-4.6"
			const customMaxTokens = 2048
			const handlerWithModel = new SyntheticHandler({
				apiModelId: modelId,
				syntheticApiKey: "test-synthetic-api-key",
				includeMaxTokens: true,
				modelMaxTokens: customMaxTokens,
			})

			mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "response" } }] })

			await handlerWithModel.completePrompt("test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: customMaxTokens,
				}),
			)
		})
	})
})
