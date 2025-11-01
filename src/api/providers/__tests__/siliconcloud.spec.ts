// npx vitest run api/providers/__tests__/siliconcloud.spec.ts

import { SiliconCloudHandler } from "../siliconcloud"
import { type ApiHandlerOptions } from "../../../shared/api"
import { siliconCloudDefaultModelId } from "@roo-code/types"
import { Package } from "../../../shared/package"
import OpenAI from "openai"

const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	const mockConstructor = vitest.fn()
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
											delta: { content: "Hello from SiliconCloud!" },
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: { content: " How can I help you?" },
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
		OpenAI: mockConstructor,
	}
})

describe("SiliconCloudHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		siliconCloudApiKey: "test-api-key",
		apiModelId: "zai-org/GLM-4.6",
		siliconCloudApiLine: "china",
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create handler with correct configuration", () => {
			const handler = new SiliconCloudHandler(mockOptions)
			expect(handler).toBeDefined()
		})

		it("should set default API line to china when not provided", () => {
			const optionsWithoutLine: ApiHandlerOptions = {
				siliconCloudApiKey: "test-api-key",
				apiModelId: "zai-org/GLM-4.6",
			}

			const handler = new SiliconCloudHandler(optionsWithoutLine)
			expect(handler).toBeDefined()
		})

		it("should initialize OpenAI client with correct baseURL for different API lines", () => {
			const mockOpenAI = vi.mocked(OpenAI)

			new SiliconCloudHandler({ ...mockOptions, siliconCloudApiLine: "international" })
			expect(mockOpenAI).toHaveBeenCalledWith({
				apiKey: "test-api-key",
				baseURL: "https://api.siliconflow.com/v1",
				defaultHeaders: {
					"HTTP-Referer": "https://kilocode.ai",
					"X-Title": "Kilo Code",
					"X-KiloCode-Version": Package.version,
					"User-Agent": `Kilo-Code/${Package.version}`,
				},
				timeout: 600000,
				fetch: expect.any(Function),
			})

			new SiliconCloudHandler({ ...mockOptions, siliconCloudApiLine: "chinaOverseas" })
			expect(mockOpenAI).toHaveBeenCalledWith({
				apiKey: "test-api-key",
				baseURL: "https://api-st.siliconflow.cn/v1",
				defaultHeaders: {
					"HTTP-Referer": "https://kilocode.ai",
					"X-Title": "Kilo Code",
					"X-KiloCode-Version": Package.version,
					"User-Agent": `Kilo-Code/${Package.version}`,
				},
				timeout: 600000,
				fetch: expect.any(Function),
			})
		})
	})

	describe("createMessage", () => {
		it("should call OpenAI client with correct parameters", async () => {
			const handler = new SiliconCloudHandler(mockOptions)

			const stream = handler.createMessage("You are a helpful coding assistant.", [
				{ role: "user", content: [{ type: "text", text: "Hello! Can you help me with this code?" }] },
			])

			await stream.next() // Consume first chunk to trigger API call

			expect(mockCreate).toHaveBeenCalledWith(
				{
					model: "zai-org/GLM-4.6",
					messages: [
						{ role: "system", content: "You are a helpful coding assistant." },
						{
							role: "user",
							content: [{ type: "text", text: "Hello! Can you help me with this code?" }],
						},
					],
					max_tokens: 202752,
					temperature: 0,
					stream: true,
					stream_options: { include_usage: true },
				},
				undefined,
			)
		})

		it("should include thinking_budget when model supports reasoning and tokens are provided", async () => {
			const handler = new SiliconCloudHandler({
				...mockOptions,
				apiModelId: "deepseek-ai/DeepSeek-V3.1-Terminus",
				modelMaxThinkingTokens: 8192,
			})

			const stream = handler.createMessage("You are a helpful coding assistant.", [
				{ role: "user", content: [{ type: "text", text: "Hello! Can you help me with this code?" }] },
			])

			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				{
					model: "deepseek-ai/DeepSeek-V3.1-Terminus",
					messages: [
						{ role: "system", content: "You are a helpful coding assistant." },
						{
							role: "user",
							content: [{ type: "text", text: "Hello! Can you help me with this code?" }],
						},
					],
					max_tokens: 163840,
					temperature: 0,
					thinking_budget: 8192,
					stream: true,
					stream_options: { include_usage: true },
				},
				undefined,
			)
		})

		it("should include enable_thinking when reasoning is enabled for supported models", async () => {
			const handler = new SiliconCloudHandler({
				...mockOptions,
				apiModelId: "deepseek-ai/DeepSeek-V3.1-Terminus",
				enableReasoningEffort: true,
			})

			const stream = handler.createMessage("You are a helpful coding assistant.", [
				{ role: "user", content: [{ type: "text", text: "Hello! Can you help me with this code?" }] },
			])

			await stream.next()

			const [params] = mockCreate.mock.calls[0]
			expect(params.enable_thinking).toBe(true)
			expect(params.thinking_budget).toBeUndefined()
		})

		it("should not include thinking parameters for non-reasoning models", async () => {
			const handler = new SiliconCloudHandler({
				...mockOptions,
				apiModelId: "moonshotai/Kimi-K2-Instruct-0905",
				modelMaxThinkingTokens: 8192,
			})

			const stream = handler.createMessage("You are a helpful coding assistant.", [
				{ role: "user", content: [{ type: "text", text: "Hello! Can you help me with this code?" }] },
			])

			await stream.next()

			const [params] = mockCreate.mock.calls[0]
			expect(params.enable_thinking).toBeUndefined()
			expect(params.thinking_budget).toBeUndefined()
		})

		it("should use model temperature when provided", async () => {
			const handler = new SiliconCloudHandler({
				...mockOptions,
				modelTemperature: 0.7,
			})

			const stream = handler.createMessage("You are a helpful coding assistant.", [
				{ role: "user", content: [{ type: "text", text: "Hello! Can you help me with this code?" }] },
			])

			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
				undefined,
			)
		})
	})

	describe("getModel", () => {
		it("should return correct model info for reasoning model", () => {
			const reasoningHandler = new SiliconCloudHandler({
				...mockOptions,
				apiModelId: "deepseek-ai/DeepSeek-V3.1-Terminus",
			})

			const model = reasoningHandler.getModel()
			expect(model.id).toBe("deepseek-ai/DeepSeek-V3.1-Terminus")
			expect(model.info.supportsReasoningBudget).toBe(true)
			expect(model.info.contextWindow).toBe(163840)
		})

		it("should handle undefined model ID", () => {
			const handlerWithoutModel = new SiliconCloudHandler({
				...mockOptions,
				apiModelId: undefined,
			})

			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(siliconCloudDefaultModelId)
			expect(model.info).toBeDefined()
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const handler = new SiliconCloudHandler(mockOptions)

			const result = await handler.completePrompt("Test prompt for SiliconCloud")

			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "zai-org/GLM-4.6",
				messages: [{ role: "user", content: "Test prompt for SiliconCloud" }],
			})
		})
	})
})
