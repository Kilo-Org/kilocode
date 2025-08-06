import { Anthropic } from "@anthropic-ai/sdk"
import Cerebras from "@cerebras/cerebras_cloud_sdk"

import { CerebrasModelId, cerebrasDefaultModelId, cerebrasModels } from "../../../shared/api"
import { CerebrasHandler } from "../cerebras"
import type { Mock } from "vitest"

const mockCreate = vi.fn()
vi.mock("@cerebras/cerebras_cloud_sdk", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

describe("CerebrasHandler", () => {
	let handler: CerebrasHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new CerebrasHandler({ cerebrasApiKey: "test-cerebras-api-key" })
	})

	test("should use the provided API key", () => {
		const cerebrasApiKey = "test-cerebras-api-key"
		new CerebrasHandler({ cerebrasApiKey })
		expect(Cerebras).toHaveBeenCalledWith(expect.objectContaining({ apiKey: cerebrasApiKey }))
	})

	test("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(cerebrasDefaultModelId.replace("-free", ""))
		expect(model.info).toEqual(cerebrasModels[cerebrasDefaultModelId])
	})

	test("should return specified model when valid model is provided", () => {
		const testModelId: CerebrasModelId = "qwen-3-32b"
		const handlerWithModel = new CerebrasHandler({
			apiModelId: testModelId,
			cerebrasApiKey: "test-cerebras-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(cerebrasModels[testModelId])
	})

	test("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Cerebras stream"

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

	test("createMessage should yield usage data from stream", async () => {
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
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: expect.any(Number),
		})
	})

	test("createMessage should pass correct parameters to Cerebras client", async () => {
		const modelId: CerebrasModelId = "qwen-3-32b"
		const handlerWithModel = new CerebrasHandler({ apiModelId: modelId, cerebrasApiKey: "test-cerebras-api-key" })

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const systemPrompt = "Test system prompt for Cerebras"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Cerebras" }]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				temperature: 0,
				stream: true,
			}),
		)
	})

	test("should handle message content conversion correctly", async () => {
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
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "data" } },
				],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Hi there" }],
			},
		]

		const messageGenerator = handler.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "Hello\n[Image content not supported in Cerebras]" },
					{ role: "assistant", content: "Hi there" },
				],
			}),
		)
	})
})
