// Mock OpenAI and axios clients before imports
const mockChatCreate = vi.fn()
const mockAxiosGet = vi.fn()

vi.mock("openai", () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(() => ({
		chat: {
			completions: {
				create: mockChatCreate,
			},
		},
	})),
}))

vi.mock("axios", () => ({
	__esModule: true,
	default: { get: (...args: any[]) => mockAxiosGet(...args) },
}))

import { describe, it, expect, beforeEach } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"

import { ProviderDefinedHandler } from "../provider-defined"
import { getProviderManifest, getProviderModels, clearAllProviderDefinedCaches } from "../fetchers/provider-defined"

const MANIFEST_URL = "http://localhost:3000/v1/models?provider=true"
const EXTENDED_MODELS_URL = "http://localhost:3000/v1/models?extended=true"
const MODEL_ID = "provider/model-name-v1"

const manifestResponse = {
	name: "Test Provider",
	website: "https://kilocode.com",
	baseUrl: "http://localhost:3000/v1",
	models_data_source: "endpoint" as const,
}

const modelsResponse = {
	models: {
		[MODEL_ID]: {
			id: MODEL_ID,
			name: "Model Name V1",
			reasoning: true,
			temperature: true,
			modalities: {
				input: ["text", "image"],
				output: ["text"],
			},
			cost: { input: 0.5, output: 1.5, cache_read: 0.2, cache_write: 0.3 },
			limit: { context: 128_000, output: 4_096 },
			description: "Mock description",
		},
	},
}

describe("ProviderDefinedHandler (mocked)", () => {
	beforeEach(() => {
		mockAxiosGet.mockReset()
		mockAxiosGet.mockImplementation(async (url: string) => {
			if (url === MANIFEST_URL) {
				return { data: manifestResponse }
			}
			if (url === EXTENDED_MODELS_URL) {
				return { data: modelsResponse }
			}
			throw new Error(`Unexpected axios GET: ${url}`)
		})

		mockChatCreate.mockReset()
		mockChatCreate.mockImplementation(async (params: any) => {
			if (params.stream) {
				return {
					[Symbol.asyncIterator]: async function* () {
						yield {
							choices: [
								{
									index: 0,
									delta: { content: "Mock streamed response." },
								},
							],
						}
						yield {
							choices: [
								{
									index: 0,
									delta: {},
								},
							],
							usage: {
								prompt_tokens: 12,
								completion_tokens: 7,
							},
						}
					},
				}
			}

			return {
				choices: [
					{
						message: {
							role: "assistant",
							content: "Mock non-stream response.",
						},
					},
				],
			}
		})

		clearAllProviderDefinedCaches()
	})

	describe("provider manifest and models", () => {
		it("returns manifest data without hitting the network", async () => {
			const manifest = await getProviderManifest(MANIFEST_URL)

			expect(manifest).toEqual(manifestResponse)
			const [url, config] = mockAxiosGet.mock.calls[0]
			expect(url).toBe(MANIFEST_URL)
			expect(config).toEqual(expect.objectContaining({ headers: undefined }))
		})

		it("maps models and pricing metadata from the extended endpoint", async () => {
			const models = await getProviderModels({ manifestUrl: MANIFEST_URL })

			expect(models).toHaveProperty(MODEL_ID)
			const info = models[MODEL_ID]

			expect(info.contextWindow).toBe(128_000)
			expect(info.maxTokens).toBe(4_096)
			expect(info.supportsImages).toBe(true)
			expect(info.supportsReasoningBudget).toBe(true)
			expect(info.inputPrice).toBeCloseTo(0.5)
			expect(info.outputPrice).toBeCloseTo(1.5)
		})
	})

	describe("ProviderDefinedHandler", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello there" }]

		it("streams responses and yields usage chunks", async () => {
			const handler = new ProviderDefinedHandler({
				providerDefinedManifestUrl: MANIFEST_URL,
				providerDefinedModelId: MODEL_ID,
			})

			const countTokensSpy = vi.spyOn(handler, "countTokens").mockResolvedValue(7)

			const stream = handler.createMessage(systemPrompt, messages, { taskId: "mock-task" })
			const collected: Array<{ type: string; text?: string }> = []
			let usageChunk: any = undefined

			for await (const chunk of stream) {
				if (chunk.type === "usage") {
					usageChunk = chunk
				} else if (chunk.type === "text" || chunk.type === "reasoning") {
					collected.push(chunk)
				}
			}

			expect(collected.map((chunk) => chunk.text).join("")).toContain("Mock streamed response")
			expect(usageChunk).toMatchObject({ inputTokens: 12, outputTokens: 7 })
			countTokensSpy.mockRestore()
		})

		it("supports non-streaming completions", async () => {
			const handler = new ProviderDefinedHandler({
				providerDefinedManifestUrl: MANIFEST_URL,
				providerDefinedModelId: MODEL_ID,
			})

			const result = await handler.completePrompt("Give me a short acknowledgement.")
			expect(result).toContain("Mock non-stream response")
			expect(mockChatCreate).toHaveBeenCalledWith({
				model: MODEL_ID,
				messages: [{ role: "user", content: "Give me a short acknowledgement." }],
				max_tokens: 4_096,
			})
		})

		it("parses embedded provider data without manifest URL", async () => {
			const embeddedModelsResponse = {
				models: {
					[MODEL_ID]: {
						id: MODEL_ID,
						name: "Example Model",
					},
				},
			}

			const embeddedJson = JSON.stringify([
				{
					name: "Embedded Provider",
					website: "https://embedded.example.com",
					baseUrl: "https://embedded.example.com/v1",
					models_data_source: "embedded" as const,
				},
				embeddedModelsResponse,
			])

			const handler = new ProviderDefinedHandler({
				providerDefinedModelId: MODEL_ID,
				providerDefinedEmbeddedJson: embeddedJson,
			})

			const result = await handler.completePrompt("Embedded completion")
			expect(result).toContain("Mock non-stream response")
			expect(handler.getModel().id).toBe(MODEL_ID)
		})
	})
})
