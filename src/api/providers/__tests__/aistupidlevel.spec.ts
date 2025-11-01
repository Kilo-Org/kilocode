// kilocode_change: file added
// npx vitest run api/providers/__tests__/aistupidlevel.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type AIStupidLevelModelId, aiStupidLevelDefaultModelId, aiStupidLevelModels } from "@roo-code/types"

import { AIStupidLevelHandler } from "../aistupidlevel"

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

describe("AIStupidLevelHandler", () => {
	let handler: AIStupidLevelHandler

	beforeEach(() => {
		vi.clearAllMocks()
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
		handler = new AIStupidLevelHandler({ aiStupidLevelApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct AIStupidLevel base URL", () => {
		new AIStupidLevelHandler({ aiStupidLevelApiKey: "test-aistupidlevel-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://api.aistupidlevel.info/v1" }),
		)
	})

	it("should use the provided API key", () => {
		const aiStupidLevelApiKey = "test-aistupidlevel-api-key"
		new AIStupidLevelHandler({ aiStupidLevelApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: aiStupidLevelApiKey }))
	})

	it("should throw error when API key is not provided", () => {
		expect(() => new AIStupidLevelHandler({})).toThrow("API key is required")
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(aiStupidLevelDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(aiStupidLevelModels[aiStupidLevelDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: AIStupidLevelModelId = "auto-reasoning"
		const handlerWithModel = new AIStupidLevelHandler({
			aiStupidLevelModelId: testModelId,
			aiStupidLevelApiKey: "test-aistupidlevel-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(aiStupidLevelModels[testModelId]))
	})

	it("should return auto-reasoning model with correct configuration", () => {
		const testModelId: AIStupidLevelModelId = "auto-reasoning"
		const handlerWithModel = new AIStupidLevelHandler({
			aiStupidLevelModelId: testModelId,
			aiStupidLevelApiKey: "test-aistupidlevel-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 8000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
			}),
		)
	})

	it("completePrompt method should return text from AIStupidLevel API", async () => {
		const expectedResponse = "This is a test response from AIStupidLevel"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "AIStupidLevel API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(
			`AIStupidLevel completion error: ${errorMessage}`,
		)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from AIStupidLevel stream"

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
		expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
	})

	it("createMessage should pass correct parameters to AIStupidLevel client", async () => {
		const modelId: AIStupidLevelModelId = "auto-reasoning"
		const modelInfo = aiStupidLevelModels[modelId]
		const handlerWithModel = new AIStupidLevelHandler({
			aiStupidLevelModelId: modelId,
			aiStupidLevelApiKey: "test-aistupidlevel-api-key",
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

		const systemPrompt = "Test system prompt for AIStupidLevel"
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Test message for AIStupidLevel" },
		]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				max_tokens: modelInfo.maxTokens,
				temperature: 0.5,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
			}),
			undefined,
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
			{ type: "usage", inputTokens: 5, outputTokens: 10 },
		])
	})

	it("should handle all routing strategy models", () => {
		const strategies: AIStupidLevelModelId[] = [
			"auto",
			"auto-coding",
			"auto-reasoning",
			"auto-creative",
			"auto-cheapest",
			"auto-fastest",
		]

		strategies.forEach((strategy) => {
			const handlerWithStrategy = new AIStupidLevelHandler({
				aiStupidLevelModelId: strategy,
				aiStupidLevelApiKey: "test-key",
			})
			const model = handlerWithStrategy.getModel()
			expect(model.id).toBe(strategy)
			expect(model.info).toEqual(expect.objectContaining(aiStupidLevelModels[strategy]))
		})
	})
})
