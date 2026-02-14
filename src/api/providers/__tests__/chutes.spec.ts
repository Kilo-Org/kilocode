// npx vitest run api/providers/__tests__/chutes.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { chutesDefaultModelId, chutesDefaultModelInfo, DEEP_SEEK_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { ChutesHandler } from "../chutes"

// Create mock functions
const mockCreate = vi.fn()
const mockFetchModel = vi.fn()

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

describe("ChutesHandler", () => {
	let handler: ChutesHandler

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
		handler = new ChutesHandler({ chutesApiKey: "test-key" })
		// Mock fetchModel to return default model
		mockFetchModel.mockResolvedValue({
			id: chutesDefaultModelId,
			info: chutesDefaultModelInfo,
		})
		handler.fetchModel = mockFetchModel
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Chutes base URL", () => {
		new ChutesHandler({ chutesApiKey: "test-chutes-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://llm.chutes.ai/v1" }))
	})

	it("should use the provided API key", () => {
		const chutesApiKey = "test-chutes-api-key"
		new ChutesHandler({ chutesApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: chutesApiKey }))
	})

	it("should handle DeepSeek R1 reasoning format", async () => {
		// Override the mock for this specific test
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { content: "<think>Thinking..." },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: { content: "</think>Hello" },
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
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]
		mockFetchModel.mockResolvedValueOnce({
			id: "deepseek-ai/DeepSeek-R1-0528",
			info: { maxTokens: 1024, temperature: 0.7 },
		})

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "reasoning", text: "Thinking..." },
			{ type: "text", text: "Hello" },
			{ type: "usage", inputTokens: 10, outputTokens: 5 },
		])
	})

	it("should handle non-DeepSeek models", async () => {
		// Use default mock implementation which returns text content
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]
		mockFetchModel.mockResolvedValueOnce({
			id: "some-other-model",
			info: { maxTokens: 1024, temperature: 0.7 },
		})

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "text", text: "Test response" },
			{ type: "usage", inputTokens: 10, outputTokens: 5 },
		])
	})

	// kilocode_change start
	it("should handle non-DeepSeek reasoning field", async () => {
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { reasoning: "Thinking through it..." },
							index: 0,
						},
					],
					usage: null,
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]
		mockFetchModel.mockResolvedValueOnce({
			id: "some-other-model",
			info: { maxTokens: 1024, temperature: 0.7 },
		})

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([{ type: "reasoning", text: "Thinking through it..." }])
	})
	// kilocode_change end

	it("should return default model when no model is specified", async () => {
		const model = await handler.fetchModel()
		expect(model.id).toBe(chutesDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(chutesDefaultModelInfo))
	})

	it("should return specified model when valid model is provided", async () => {
		const testModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		// Mock fetchModel for this handler to return the test model from dynamic fetch
		handlerWithModel.fetchModel = vi.fn().mockResolvedValue({
			id: testModelId,
			info: { maxTokens: 32768, contextWindow: 163840, supportsImages: false, supportsPromptCache: false },
		})
		const model = await handlerWithModel.fetchModel()
		expect(model.id).toBe(testModelId)
	})

	it("completePrompt method should return text from Chutes API", async () => {
		const expectedResponse = "This is a test response from Chutes"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Chutes API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`Chutes completion error: ${errorMessage}`)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Chutes stream"

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

	it("createMessage should yield tool_call_partial from stream", async () => {
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [
									{
										delta: {
											tool_calls: [
												{
													index: 0,
													id: "call_123",
													function: { name: "test_tool", arguments: '{"arg":"value"}' },
												},
											],
										},
									},
								],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "call_123",
			name: "test_tool",
			arguments: '{"arg":"value"}',
		})
	})

	// kilocode_change start
	it("createMessage should yield tool_call_end on finish_reason tool_calls", async () => {
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [
									{
										delta: {
											tool_calls: [
												{
													index: 0,
													id: "call_finish",
													function: { name: "test_tool", arguments: '{"arg":"value"}' },
												},
											],
										},
										finish_reason: null,
									},
								],
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [
									{
										delta: {},
										finish_reason: "tool_calls",
									},
								],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call_partial",
				index: 0,
				id: "call_finish",
				name: "test_tool",
				arguments: '{"arg":"value"}',
			},
			{
				type: "tool_call_end",
				id: "call_finish",
			},
		])
	})

	it("createMessage should synthesize tool call ids when provider omits them", async () => {
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [
									{
										delta: {
											tool_calls: [
												{
													index: 0,
													function: { name: "test_tool", arguments: '{"arg":"value"}' },
												},
											],
										},
										finish_reason: null,
									},
								],
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [
									{
										delta: {},
										finish_reason: "tool_calls",
									},
								],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{
				type: "tool_call_partial",
				index: 0,
				id: "chutes_tool_call_0",
				name: "test_tool",
				arguments: '{"arg":"value"}',
			},
			{
				type: "tool_call_end",
				id: "chutes_tool_call_0",
			},
		])
	})
	// kilocode_change end

	it("createMessage should pass tools and tool_choice to API", async () => {
		const tools = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "A test tool",
					parameters: { type: "object", properties: {} },
				},
			},
		]
		const tool_choice = "auto" as const

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi.fn().mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [], { tools, tool_choice, taskId: "test-task-id" })
		// Consume stream
		for await (const _ of stream) {
			// noop
		}

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tools,
				tool_choice,
			}),
			expect.objectContaining({
				timeout: expect.any(Number),
			}),
		)
	})

	it("should apply DeepSeek default temperature for R1 models", () => {
		const testModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.info.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
	})

	it("should use default temperature for non-DeepSeek models", () => {
		const testModelId = "unsloth/Llama-3.3-70B-Instruct"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		;(handlerWithModel as any).models = {
			[testModelId]: {
				...chutesDefaultModelInfo,
				temperature: 0.7,
			},
		}
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info.temperature).toBe(0.5)
	})

	// kilocode_change start
	it("should preserve explicit Chutes model id when it is unavailable in cached model list", () => {
		const unsupportedModelId = "moonshotai/Kimi-K2.5-TEE"
		const handlerWithModel = new ChutesHandler({
			apiModelId: unsupportedModelId,
			chutesApiKey: "test-chutes-api-key",
		})

		const model = handlerWithModel.getModel()

		expect(model.id).toBe(unsupportedModelId)
		expect(model.info.temperature).toBe(0.5)
	})
	// kilocode_change end
})
