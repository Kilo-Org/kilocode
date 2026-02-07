// cd src && npx vitest run api/providers/__tests__/openai-codex-native-tool-calls.spec.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

import { OpenAiCodexHandler } from "../openai-codex"
import type { ApiHandlerOptions } from "../../../shared/api"
import { NativeToolCallParser } from "../../../core/assistant-message/NativeToolCallParser"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

describe("OpenAiCodexHandler native tool calls", () => {
	let handler: OpenAiCodexHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		vi.restoreAllMocks()
		NativeToolCallParser.clearRawChunkState()
		NativeToolCallParser.clearAllStreamingToolCalls()

		mockOptions = {
			apiModelId: "gpt-5.2-2025-12-11",
			// minimal settings; OAuth is mocked below
		}
		handler = new OpenAiCodexHandler(mockOptions)
	})

	it("yields tool_call_partial chunks when API returns function_call-only response", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")

		// Mock OpenAI SDK streaming (preferred path).
		;(handler as any).client = {
			responses: {
				create: vi.fn().mockResolvedValue({
					async *[Symbol.asyncIterator]() {
						yield {
							type: "response.output_item.added",
							item: {
								type: "function_call",
								call_id: "call_1",
								name: "attempt_completion",
								arguments: "",
							},
							output_index: 0,
						}
						yield {
							type: "response.function_call_arguments.delta",
							delta: '{"result":"hi"}',
							// Note: intentionally omit call_id + name to simulate tool-call-only streams.
							item_id: "fc_1",
							output_index: 0,
						}
						yield {
							type: "response.completed",
							response: {
								id: "resp_1",
								status: "completed",
								output: [
									{
										type: "function_call",
										call_id: "call_1",
										name: "attempt_completion",
										arguments: '{"result":"hi"}',
									},
								],
								usage: { input_tokens: 1, output_tokens: 1 },
							},
						}
					},
				}),
			},
		}

		const stream = handler.createMessage("system", [{ role: "user", content: "hello" } as any], {
			taskId: "t",
			toolProtocol: "native",
			tools: [],
		})

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
			if (chunk.type === "tool_call_partial") {
				// Simulate Task.ts behavior so finish_reason handling can emit tool_call_end elsewhere
				NativeToolCallParser.processRawChunk({
					index: chunk.index,
					id: chunk.id,
					name: chunk.name,
					arguments: chunk.arguments,
				})
			}
		}

		const toolChunks = chunks.filter((c) => c.type === "tool_call_partial")
		expect(toolChunks.length).toBeGreaterThan(0)
		expect(toolChunks[0]).toMatchObject({
			type: "tool_call_partial",
			id: "call_1",
			name: "attempt_completion",
		})
	})
})
