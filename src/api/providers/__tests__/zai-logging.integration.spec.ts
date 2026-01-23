// Integration test for Z.ai handler logging
// This test verifies that request/response logging is working correctly

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { describe, it, expect, beforeEach, vi } from "vitest"

import { internationalZAiModels, internationalZAiDefaultModelId, ZAI_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { ZAiHandler } from "../zai"
import { logger } from "../../../utils/logging"

// Mock VSCode
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(600),
		}),
	},
}))

// Mock OpenAI client
vi.mock("openai", () => {
	const createMock = vi.fn()
	return {
		default: vi.fn(() => ({ chat: { completions: { create: createMock } } })),
	}
})

// Spy on logger
const loggerSpy = {
	debug: vi.spyOn(logger, "debug"),
	info: vi.spyOn(logger, "info"),
	error: vi.spyOn(logger, "error"),
}

describe("Z.ai Logging Integration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Object.values(loggerSpy).forEach((spy) => spy.mockClear())
	})

	it("should log Z.ai API request with correct endpoint information", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.7",
			zaiApiKey: "test-key",
			zaiApiLine: "international_coding",
			enableReasoningEffort: true,
			reasoningEffort: "medium",
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const stream = handler.createMessage("system", [])
		await stream.next()

		// Verify debug log for GLM-4.7 thinking mode was called
		expect(loggerSpy.debug).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai GLM-4.7 thinking mode request"),
			expect.objectContaining({
				model: "glm-4.7",
				useReasoning: true,
				enableReasoningEffort: true,
				reasoningEffort: "medium",
			}),
		)

		// Verify info log for API request was called with endpoint details
		expect(loggerSpy.info).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai API request"),
			expect.objectContaining({
				provider: "Z.ai",
				baseUrl: "https://api.z.ai/api/coding/paas/v4",
				model: "glm-4.7",
				thinkingMode: "enabled",
				zaiApiLine: "international_coding",
			}),
		)
	})

	it("should log Z.ai thinking mode disabled for non-reasoning requests", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.7",
			zaiApiKey: "test-key",
			zaiApiLine: "international_coding",
			enableReasoningEffort: false,
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const stream = handler.createMessage("system", [])
		await stream.next()

		// Verify thinking mode is disabled in log
		expect(loggerSpy.info).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai API request"),
			expect.objectContaining({
				thinkingMode: "disabled",
			}),
		)
	})

	it("should use correct endpoint for china_coding API line", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.7", // Must be thinking model to trigger logging
			zaiApiKey: "china-key",
			zaiApiLine: "china_coding",
			enableReasoningEffort: true,
			reasoningEffort: "medium",
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const stream = handler.createMessage("system", [])
		await stream.next()

		// Verify correct China endpoint is configured
		expect(loggerSpy.info).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai API request"),
			expect.objectContaining({
				baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
				zaiApiLine: "china_coding",
			}),
		)
	})

	it("should log standard model request for non-thinking models", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.5",
			zaiApiKey: "test-key",
			zaiApiLine: "international_coding",
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const stream = handler.createMessage("system", [])
		await stream.next()

		// Verify standard model log was called (not thinking mode log)
		expect(loggerSpy.debug).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai standard model request"),
			expect.objectContaining({
				model: "glm-4.5",
			}),
		)
	})

	it("should log API response characteristics with reasoning content", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.7",
			zaiApiKey: "test-key",
			zaiApiLine: "international_coding",
			enableReasoningEffort: true,
			reasoningEffort: "medium",
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { reasoning_content: "Let me think about this..." } }],
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { content: "Here is my response" } }],
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: { prompt_tokens: 100, completion_tokens: 50 },
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [])) {
			chunks.push(chunk)
		}

		// Verify response logging captured reasoning content
		expect(loggerSpy.debug).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai createMessage completed"),
			expect.objectContaining({
				model: "glm-4.7",
				hasReasoningContent: true,
			}),
		)

		// Verify actual chunks were processed correctly
		expect(chunks.some((c) => c.type === "reasoning")).toBe(true)
		expect(chunks.some((c) => c.type === "text")).toBe(true)
		expect(chunks.some((c) => c.type === "usage")).toBe(true)
	})

	it("should log API errors when request fails", async () => {
		const handler = new ZAiHandler({
			apiModelId: "glm-4.7",
			zaiApiKey: "test-key",
			zaiApiLine: "international_coding",
		})

		const mockCreate = (OpenAI as unknown as any)().chat.completions.create
		const testError = new Error("Z.ai API connection timeout")

		mockCreate.mockImplementationOnce(() => {
			throw testError
		})

		try {
			const stream = handler.createMessage("system", [])
			await stream.next()
		} catch (e) {
			// Expected error
		}

		// Verify error was logged with context
		expect(loggerSpy.error).toHaveBeenCalledWith(
			expect.stringContaining("Z.ai API request failed"),
			expect.objectContaining({
				provider: "Z.ai",
				model: "glm-4.7",
				error: "Z.ai API connection timeout",
			}),
		)
	})
})
