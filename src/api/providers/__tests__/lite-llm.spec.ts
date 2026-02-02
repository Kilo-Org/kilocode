import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { LiteLLMHandler } from "../lite-llm"
import { ApiHandlerOptions } from "../../../shared/api"
import { litellmDefaultModelId, litellmDefaultModelInfo, TOOL_PROTOCOL } from "@roo-code/types"

// Mock vscode first to avoid import errors
vi.mock("vscode", () => ({}))

// Mock OpenAI
const mockCreate = vi.fn()

vi.mock("openai", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

// Mock model fetching
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn().mockImplementation(() => {
		return Promise.resolve({
			[litellmDefaultModelId]: litellmDefaultModelInfo,
			"gpt-5": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			gpt5: { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"GPT-5": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-5-turbo": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt5-preview": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-5o": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-5.1": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-5-mini": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-4": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"claude-3-opus": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"llama-3": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			"gpt-4-turbo": { ...litellmDefaultModelInfo, maxTokens: 8192 },
			// Gemini models for thought signature injection tests
			"gemini-3-pro": { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
			"gemini-3-flash": { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
			"gemini-2.5-pro": { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
			"google/gemini-3-pro": { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
			"vertex_ai/gemini-3-pro": { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
		})
	}),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

describe("LiteLLMHandler", () => {
	let handler: LiteLLMHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		vi.clearAllMocks()
		mockOptions = {
			litellmApiKey: "test-key",
			litellmBaseUrl: "http://localhost:4000",
			litellmModelId: litellmDefaultModelId,
		}
		handler = new LiteLLMHandler(mockOptions)
	})

	describe("prompt caching", () => {
		it("should add cache control headers when litellmUsePromptCache is enabled", async () => {
			const optionsWithCache: ApiHandlerOptions = {
				...mockOptions,
				litellmUsePromptCache: true,
			}
			handler = new LiteLLMHandler(optionsWithCache)

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
				{ role: "user", content: "How are you?" },
			]

			// Mock the stream response
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						choices: [{ delta: { content: "I'm doing well!" } }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 50,
							cache_creation_input_tokens: 20,
							cache_read_input_tokens: 30,
						},
					}
				},
			}

			mockCreate.mockReturnValue({
				withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
			})

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Verify that create was called with cache control headers
			const createCall = mockCreate.mock.calls[0][0]

			// Check system message has cache control in the proper format
			expect(createCall.messages[0]).toMatchObject({
				role: "system",
				content: [
					{
						type: "text",
						text: systemPrompt,
						cache_control: { type: "ephemeral" },
					},
				],
			})

			// Check that the last two user messages have cache control
			const userMessageIndices = createCall.messages
				.map((msg: any, idx: number) => (msg.role === "user" ? idx : -1))
				.filter((idx: number) => idx !== -1)

			const lastUserIdx = userMessageIndices[userMessageIndices.length - 1]
			const secondLastUserIdx = userMessageIndices[userMessageIndices.length - 2]

			// Check last user message has proper structure with cache control
			expect(createCall.messages[lastUserIdx]).toMatchObject({
				role: "user",
				content: [
					{
						type: "text",
						text: "How are you?",
						cache_control: { type: "ephemeral" },
					},
				],
			})

			// Check second last user message (first user message in this case)
			if (secondLastUserIdx !== -1) {
				expect(createCall.messages[secondLastUserIdx]).toMatchObject({
					role: "user",
					content: [
						{
							type: "text",
							text: "Hello",
							cache_control: { type: "ephemeral" },
						},
					],
				})
			}

			// Verify usage includes cache tokens
			const usageChunk = results.find((chunk) => chunk.type === "usage")
			expect(usageChunk).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 20,
				cacheReadTokens: 30,
			})
		})
	})

	describe("GPT-5 model handling", () => {
		it("should use max_completion_tokens instead of max_tokens for GPT-5 models", async () => {
			const optionsWithGPT5: ApiHandlerOptions = {
				...mockOptions,
				litellmModelId: "gpt-5",
			}
			handler = new LiteLLMHandler(optionsWithGPT5)

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			// Mock the stream response
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						choices: [{ delta: { content: "Hello!" } }],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 5,
						},
					}
				},
			}

			mockCreate.mockReturnValue({
				withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
			})

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			// Verify that create was called with max_completion_tokens instead of max_tokens
			const createCall = mockCreate.mock.calls[0][0]

			// Should have max_completion_tokens, not max_tokens
			expect(createCall.max_completion_tokens).toBeDefined()
			expect(createCall.max_tokens).toBeUndefined()
		})

		it("should use max_completion_tokens for various GPT-5 model variations", async () => {
			const gpt5Variations = [
				"gpt-5",
				"gpt5",
				"GPT-5",
				"gpt-5-turbo",
				"gpt5-preview",
				"gpt-5o",
				"gpt-5.1",
				"gpt-5-mini",
			]

			for (const modelId of gpt5Variations) {
				vi.clearAllMocks()

				const optionsWithGPT5: ApiHandlerOptions = {
					...mockOptions,
					litellmModelId: modelId,
				}
				handler = new LiteLLMHandler(optionsWithGPT5)

				const systemPrompt = "You are a helpful assistant"
				const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test" }]

				// Mock the stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield {
							choices: [{ delta: { content: "Response" } }],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
							},
						}
					},
				}

				mockCreate.mockReturnValue({
					withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
				})

				const generator = handler.createMessage(systemPrompt, messages)
				for await (const chunk of generator) {
					// Consume the generator
				}

				// Verify that create was called with max_completion_tokens for this model variation
				const createCall = mockCreate.mock.calls[0][0]

				expect(createCall.max_completion_tokens).toBeDefined()
				expect(createCall.max_tokens).toBeUndefined()
			}
		})

		// kilocode_change: we always use the non-deprecated one
		it.skip("should still use max_tokens for non-GPT-5 models", async () => {
			const nonGPT5Models = ["gpt-4", "claude-3-opus", "llama-3", "gpt-4-turbo"]

			for (const modelId of nonGPT5Models) {
				vi.clearAllMocks()

				const options: ApiHandlerOptions = {
					...mockOptions,
					litellmModelId: modelId,
				}
				handler = new LiteLLMHandler(options)

				const systemPrompt = "You are a helpful assistant"
				const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test" }]

				// Mock the stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield {
							choices: [{ delta: { content: "Response" } }],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
							},
						}
					},
				}

				mockCreate.mockReturnValue({
					withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
				})

				const generator = handler.createMessage(systemPrompt, messages)
				for await (const chunk of generator) {
					// Consume the generator
				}

				// Verify that create was called with max_tokens for non-GPT-5 models
				const createCall = mockCreate.mock.calls[0][0]

				expect(createCall.max_tokens).toBeDefined()
				expect(createCall.max_completion_tokens).toBeUndefined()
			}
		})

		it("should use max_completion_tokens in completePrompt for GPT-5 models", async () => {
			const optionsWithGPT5: ApiHandlerOptions = {
				...mockOptions,
				litellmModelId: "gpt-5",
			}
			handler = new LiteLLMHandler(optionsWithGPT5)

			mockCreate.mockResolvedValue({
				choices: [{ message: { content: "Test response" } }],
			})

			await handler.completePrompt("Test prompt")

			// Verify that create was called with max_completion_tokens
			const createCall = mockCreate.mock.calls[0][0]

			expect(createCall.max_completion_tokens).toBeDefined()
			expect(createCall.max_tokens).toBeUndefined()
		})

		it("should not set any max token fields when maxTokens is undefined (GPT-5 streaming)", async () => {
			const optionsWithGPT5: ApiHandlerOptions = {
				...mockOptions,
				litellmModelId: "gpt-5",
			}
			handler = new LiteLLMHandler(optionsWithGPT5)

			// Force fetchModel to return undefined maxTokens
			vi.spyOn(handler as any, "fetchModel").mockResolvedValue({
				id: "gpt-5",
				info: { ...litellmDefaultModelInfo, maxTokens: undefined },
			})

			// Mock the stream response
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						choices: [{ delta: { content: "Hello!" } }],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 5,
						},
					}
				},
			}

			mockCreate.mockReturnValue({
				withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
			})

			const generator = handler.createMessage("You are a helpful assistant", [
				{ role: "user", content: "Hello" } as unknown as Anthropic.Messages.MessageParam,
			])
			for await (const _chunk of generator) {
				// consume
			}

			// Should not include either token field
			const createCall = mockCreate.mock.calls[0][0]
			expect(createCall.max_tokens).toBeUndefined()
			expect(createCall.max_completion_tokens).toBeUndefined()
		})

		it("should not set any max token fields when maxTokens is undefined (GPT-5 completePrompt)", async () => {
			const optionsWithGPT5: ApiHandlerOptions = {
				...mockOptions,
				litellmModelId: "gpt-5",
			}
			handler = new LiteLLMHandler(optionsWithGPT5)

			// Force fetchModel to return undefined maxTokens
			vi.spyOn(handler as any, "fetchModel").mockResolvedValue({
				id: "gpt-5",
				info: { ...litellmDefaultModelInfo, maxTokens: undefined },
			})

			mockCreate.mockResolvedValue({
				choices: [{ message: { content: "Ok" } }],
			})

			await handler.completePrompt("Test prompt")

			const createCall = mockCreate.mock.calls[0][0]
			expect(createCall.max_tokens).toBeUndefined()
			expect(createCall.max_completion_tokens).toBeUndefined()
		})
	})

	describe("Gemini thought signature injection", () => {
		describe("isGeminiModel detection", () => {
			it("should detect Gemini 3 models", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const isGeminiModel = (handler as any).isGeminiModel.bind(handler)

				expect(isGeminiModel("gemini-3-pro")).toBe(true)
				expect(isGeminiModel("gemini-3-flash")).toBe(true)
				expect(isGeminiModel("gemini-3-pro-preview")).toBe(true)
			})

			it("should detect Gemini 2.5 models", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const isGeminiModel = (handler as any).isGeminiModel.bind(handler)

				expect(isGeminiModel("gemini-2.5-pro")).toBe(true)
				expect(isGeminiModel("gemini-2.5-flash")).toBe(true)
			})

			it("should detect Gemini models with spaces (LiteLLM model groups)", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const isGeminiModel = (handler as any).isGeminiModel.bind(handler)

				// LiteLLM model groups often use space-separated names with title case
				expect(isGeminiModel("Gemini 3 Pro")).toBe(true)
				expect(isGeminiModel("Gemini 3 Flash")).toBe(true)
				expect(isGeminiModel("gemini 3 pro")).toBe(true)
				expect(isGeminiModel("Gemini 2.5 Pro")).toBe(true)
				expect(isGeminiModel("gemini 2.5 flash")).toBe(true)
			})

			it("should detect provider-prefixed Gemini models", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const isGeminiModel = (handler as any).isGeminiModel.bind(handler)

				expect(isGeminiModel("google/gemini-3-pro")).toBe(true)
				expect(isGeminiModel("vertex_ai/gemini-3-pro")).toBe(true)
				expect(isGeminiModel("vertex/gemini-2.5-pro")).toBe(true)
				// Space-separated variants with provider prefix
				expect(isGeminiModel("google/gemini 3 pro")).toBe(true)
				expect(isGeminiModel("vertex_ai/gemini 2.5 pro")).toBe(true)
			})

			it("should not detect non-Gemini models", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const isGeminiModel = (handler as any).isGeminiModel.bind(handler)

				expect(isGeminiModel("gpt-4")).toBe(false)
				expect(isGeminiModel("claude-3-opus")).toBe(false)
				expect(isGeminiModel("gemini-1.5-pro")).toBe(false)
				expect(isGeminiModel("gemini-2.0-flash")).toBe(false)
			})
		})

		describe("injectThoughtSignatureForGemini", () => {
			// Base64 encoded "skip_thought_signature_validator"
			const dummySignature = Buffer.from("skip_thought_signature_validator").toString("base64")

			it("should inject provider_specific_fields.thought_signature for assistant messages with tool_calls", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const injectThoughtSignature = (handler as any).injectThoughtSignatureForGemini.bind(handler)

				const messages = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{ id: "call_123", type: "function", function: { name: "test_tool", arguments: "{}" } },
						],
					},
					{ role: "tool", tool_call_id: "call_123", content: "result" },
				]

				const result = injectThoughtSignature(messages)

				// The first tool call should have provider_specific_fields.thought_signature injected
				expect(result[1].tool_calls[0].provider_specific_fields).toBeDefined()
				expect(result[1].tool_calls[0].provider_specific_fields.thought_signature).toBe(dummySignature)
			})

			it("should not inject if assistant message has no tool_calls", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const injectThoughtSignature = (handler as any).injectThoughtSignatureForGemini.bind(handler)

				const messages = [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
				]

				const result = injectThoughtSignature(messages)

				// No changes should be made
				expect(result[1].tool_calls).toBeUndefined()
			})

			it("should always overwrite existing thought_signature", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const injectThoughtSignature = (handler as any).injectThoughtSignatureForGemini.bind(handler)

				const existingSignature = "existing_signature_base64"

				const messages = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_123",
								type: "function",
								function: { name: "test_tool", arguments: "{}" },
								provider_specific_fields: { thought_signature: existingSignature },
							},
						],
					},
				]

				const result = injectThoughtSignature(messages)

				// Should overwrite with dummy signature (always inject to ensure compatibility)
				expect(result[1].tool_calls[0].provider_specific_fields.thought_signature).toBe(dummySignature)
			})

			it("should inject signature into ALL tool calls for parallel calls", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const injectThoughtSignature = (handler as any).injectThoughtSignatureForGemini.bind(handler)

				const messages = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{ id: "call_first", type: "function", function: { name: "tool1", arguments: "{}" } },
							{ id: "call_second", type: "function", function: { name: "tool2", arguments: "{}" } },
							{ id: "call_third", type: "function", function: { name: "tool3", arguments: "{}" } },
						],
					},
				]

				const result = injectThoughtSignature(messages)

				// ALL tool calls should have the signature
				expect(result[1].tool_calls[0].provider_specific_fields.thought_signature).toBe(dummySignature)
				expect(result[1].tool_calls[1].provider_specific_fields.thought_signature).toBe(dummySignature)
				expect(result[1].tool_calls[2].provider_specific_fields.thought_signature).toBe(dummySignature)
			})

			it("should preserve existing provider_specific_fields when adding thought_signature", () => {
				const handler = new LiteLLMHandler(mockOptions)
				const injectThoughtSignature = (handler as any).injectThoughtSignatureForGemini.bind(handler)

				const messages = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_123",
								type: "function",
								function: { name: "test_tool", arguments: "{}" },
								provider_specific_fields: { other_field: "value" },
							},
						],
					},
				]

				const result = injectThoughtSignature(messages)

				// Should have both existing field and new thought_signature
				expect(result[1].tool_calls[0].provider_specific_fields.other_field).toBe("value")
				expect(result[1].tool_calls[0].provider_specific_fields.thought_signature).toBe(dummySignature)
			})
		})

		describe("createMessage integration with Gemini models", () => {
			// Base64 encoded "skip_thought_signature_validator"
			const dummySignature = Buffer.from("skip_thought_signature_validator").toString("base64")

			it("should inject thought signatures for Gemini 3 models with native tools", async () => {
				const optionsWithGemini: ApiHandlerOptions = {
					...mockOptions,
					litellmModelId: "gemini-3-pro",
				}
				handler = new LiteLLMHandler(optionsWithGemini)

				// Mock fetchModel to return a Gemini model with native tool support
				vi.spyOn(handler as any, "fetchModel").mockResolvedValue({
					id: "gemini-3-pro",
					info: { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
				})

				const systemPrompt = "You are a helpful assistant"
				// Simulate conversation history with a tool call from a previous model (Claude)
				const messages: Anthropic.Messages.MessageParam[] = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I'll help you with that." },
							{ type: "tool_use", id: "toolu_123", name: "read_file", input: { path: "test.txt" } },
						],
					},
					{
						role: "user",
						content: [{ type: "tool_result", tool_use_id: "toolu_123", content: "file contents" }],
					},
					{ role: "user", content: "Thanks!" },
				]

				// Mock the stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield {
							choices: [{ delta: { content: "You're welcome!" } }],
							usage: {
								prompt_tokens: 100,
								completion_tokens: 20,
							},
						}
					},
				}

				mockCreate.mockReturnValue({
					withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
				})

				// Provide tools and native protocol to trigger the injection
				const metadata = {
					tools: [
						{
							type: "function",
							function: { name: "read_file", description: "Read a file", parameters: {} },
						},
					],
					toolProtocol: TOOL_PROTOCOL.NATIVE,
				}

				const generator = handler.createMessage(systemPrompt, messages, metadata as any)
				for await (const _chunk of generator) {
					// Consume the generator
				}

				// Verify that the assistant message with tool_calls has thought_signature injected
				const createCall = mockCreate.mock.calls[0][0]
				const assistantMessage = createCall.messages.find(
					(msg: any) => msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0,
				)

				expect(assistantMessage).toBeDefined()
				// First tool call should have the thought signature
				expect(assistantMessage.tool_calls[0].provider_specific_fields).toBeDefined()
				expect(assistantMessage.tool_calls[0].provider_specific_fields.thought_signature).toBe(dummySignature)
			})

			it("should not inject thought signatures for non-Gemini models", async () => {
				const optionsWithGPT4: ApiHandlerOptions = {
					...mockOptions,
					litellmModelId: "gpt-4",
				}
				handler = new LiteLLMHandler(optionsWithGPT4)

				vi.spyOn(handler as any, "fetchModel").mockResolvedValue({
					id: "gpt-4",
					info: { ...litellmDefaultModelInfo, maxTokens: 8192, supportsNativeTools: true },
				})

				const systemPrompt = "You are a helpful assistant"
				const messages: Anthropic.Messages.MessageParam[] = [
					{ role: "user", content: "Hello" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I'll help you with that." },
							{ type: "tool_use", id: "toolu_123", name: "read_file", input: { path: "test.txt" } },
						],
					},
					{
						role: "user",
						content: [{ type: "tool_result", tool_use_id: "toolu_123", content: "file contents" }],
					},
				]

				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield {
							choices: [{ delta: { content: "Response" } }],
							usage: { prompt_tokens: 100, completion_tokens: 20 },
						}
					},
				}

				mockCreate.mockReturnValue({
					withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
				})

				const metadata = {
					tools: [
						{
							type: "function",
							function: { name: "read_file", description: "Read a file", parameters: {} },
						},
					],
					toolProtocol: TOOL_PROTOCOL.NATIVE,
				}

				const generator = handler.createMessage(systemPrompt, messages, metadata as any)
				for await (const _chunk of generator) {
					// Consume
				}

				// Verify that thought_signature was NOT injected for non-Gemini model
				const createCall = mockCreate.mock.calls[0][0]
				const assistantMessage = createCall.messages.find(
					(msg: any) => msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0,
				)

				expect(assistantMessage).toBeDefined()
				// Tool calls should not have provider_specific_fields added
				expect(assistantMessage.tool_calls[0].provider_specific_fields).toBeUndefined()
			})
		})
	})
})
