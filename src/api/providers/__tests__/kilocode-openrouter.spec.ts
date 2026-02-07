// kilocode_change - new file
// npx vitest run src/api/providers/__tests__/kilocode-openrouter.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({
	env: {
		uriScheme: "vscode",
		language: "en",
		uiKind: 1,
		appName: "Visual Studio Code",
	},
	version: "1.85.0",
}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { KilocodeOpenrouterHandler } from "../kilocode-openrouter"
import { ApiHandlerOptions } from "../../../shared/api"
import {
	X_KILOCODE_TASKID,
	X_KILOCODE_ORGANIZATIONID,
	X_KILOCODE_PROJECTID,
	X_KILOCODE_EDITORNAME,
	X_KILOCODE_MODE,
} from "../../../shared/kilocode/headers"
import { streamSse } from "../../../services/continuedev/core/fetch/stream"

// Mock the stream module
vitest.mock("../../../services/continuedev/core/fetch/stream", () => ({
	streamSse: vitest.fn(),
}))

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockResolvedValue({
		"anthropic/claude-sonnet-4": {
			maxTokens: 8192,
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 3,
			outputPrice: 15,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
			description: "Claude 3.7 Sonnet",
		},
	}),
}))
vitest.mock("../fetchers/modelEndpointCache", () => ({
	getModelEndpoints: vitest.fn().mockResolvedValue({}),
}))
vitest.mock("../kilocode/getKilocodeDefaultModel", () => ({
	getKilocodeDefaultModel: vitest.fn().mockResolvedValue("anthropic/claude-sonnet-4"),
}))

describe("KilocodeOpenrouterHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		kilocodeToken: "test-token",
		kilocodeModel: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("getRolloutHash returns a deterministic hash based on token", () => {
		const handler = new KilocodeOpenrouterHandler({ ...mockOptions, kilocodeToken: undefined })
		expect(handler.getRolloutHash()).toBeUndefined()

		const handlerA = new KilocodeOpenrouterHandler({ ...mockOptions, kilocodeToken: "token-A" })
		expect(handlerA.getRolloutHash()).toEqual(4000417282)

		const handlerB = new KilocodeOpenrouterHandler({ ...mockOptions, kilocodeToken: "token-B" })
		expect(handlerB.getRolloutHash()).toEqual(398635706)
	})

	describe("customRequestOptions", () => {
		it("includes taskId header when provided in metadata", () => {
			const handler = new KilocodeOpenrouterHandler(mockOptions)
			const result = handler.customRequestOptions({ taskId: "test-task-id", mode: "code" })

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
		})

		it("includes organizationId header when configured", () => {
			const handler = new KilocodeOpenrouterHandler({
				...mockOptions,
				kilocodeOrganizationId: "test-org-id",
			})
			const result = handler.customRequestOptions({ taskId: "test-task-id", mode: "code" })

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
		})

		it("includes projectId header when provided in metadata with organizationId", () => {
			const handler = new KilocodeOpenrouterHandler({
				...mockOptions,
				kilocodeOrganizationId: "test-org-id",
			})
			const result = handler.customRequestOptions({
				taskId: "test-task-id",
				mode: "code",
				projectId: "https://github.com/user/repo.git",
			})

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
		})

		it("includes all headers when all metadata is provided", () => {
			const handler = new KilocodeOpenrouterHandler({
				...mockOptions,
				kilocodeOrganizationId: "test-org-id",
			})
			const result = handler.customRequestOptions({
				taskId: "test-task-id",
				mode: "code",
				projectId: "https://github.com/user/repo.git",
			})

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
		})

		it("omits projectId header when not provided in metadata", () => {
			const handler = new KilocodeOpenrouterHandler({
				...mockOptions,
				kilocodeOrganizationId: "test-org-id",
			})
			const result = handler.customRequestOptions({ taskId: "test-task-id", mode: "code" })

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
			expect(result?.headers).not.toHaveProperty(X_KILOCODE_PROJECTID)
		})

		it("omits projectId header when no organizationId is configured", () => {
			const handler = new KilocodeOpenrouterHandler(mockOptions)
			const result = handler.customRequestOptions({
				taskId: "test-task-id",
				mode: "code",
				projectId: "https://github.com/user/repo.git",
			})

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_MODE]: "code",
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
			expect(result?.headers).not.toHaveProperty(X_KILOCODE_PROJECTID)
		})

		it("returns only editorName header when no other headers are needed", () => {
			const handler = new KilocodeOpenrouterHandler(mockOptions)
			const result = handler.customRequestOptions()

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
				},
			})
		})
	})

	describe("createMessage", () => {
		it("passes custom headers to OpenAI client", async () => {
			const handler = new KilocodeOpenrouterHandler({
				...mockOptions,
				kilocodeOrganizationId: "test-org-id",
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test response" } }],
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const systemPrompt = "test system prompt"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
			const metadata = {
				taskId: "test-task-id",
				mode: "code",
				projectId: "https://github.com/user/repo.git",
			}

			const generator = handler.createMessage(systemPrompt, messages, metadata)
			await generator.next()

			// Verify the second argument (options) contains our custom headers
			expect(mockCreate).toHaveBeenCalledWith(
				expect.any(Object),
				// kilocode_change start
				expect.objectContaining({
					headers: expect.objectContaining({
						[X_KILOCODE_MODE]: "code",
						[X_KILOCODE_TASKID]: "test-task-id",
						[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
						[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
						[X_KILOCODE_EDITORNAME]: "Visual Studio Code 1.85.0",
					}),
				}),
				// kilocode_change end
			)
		})
	})

	describe("FIM support", () => {
		describe("fimSupport", () => {
			it("returns FimHandler for codestral models", () => {
				const handler = new KilocodeOpenrouterHandler({
					...mockOptions,
					kilocodeModel: "mistral/codestral-latest",
				})

				const fimHandler = handler.fimSupport()
				expect(fimHandler).toBeDefined()
				expect(typeof fimHandler?.streamFim).toBe("function")
				expect(typeof fimHandler?.getModel).toBe("function")
				expect(typeof fimHandler?.getTotalCost).toBe("function")
			})

			it("returns undefined for non-codestral models", () => {
				const handler = new KilocodeOpenrouterHandler({
					...mockOptions,
					kilocodeModel: "anthropic/claude-sonnet-4",
				})

				expect(handler.fimSupport()).toBeUndefined()
			})
		})

		describe("streamFim via fimSupport()", () => {
			it("yields chunks correctly", async () => {
				const handler = new KilocodeOpenrouterHandler({
					...mockOptions,
					kilocodeModel: "mistral/codestral-latest",
				})

				// Mock streamSse to return the expected data
				;(streamSse as any).mockImplementation(async function* () {
					yield { choices: [{ delta: { content: "chunk1" } }] }
					yield { choices: [{ delta: { content: "chunk2" } }] }
					yield {
						usage: {
							prompt_tokens: 10,
							completion_tokens: 5,
							total_tokens: 15,
						},
					}
				})

				const mockResponse = {
					ok: true,
					status: 200,
					statusText: "OK",
				} as Response

				global.fetch = vitest.fn().mockResolvedValue(mockResponse)

				const chunks: string[] = []
				let receivedUsage: any = null

				const fimHandler = handler.fimSupport()
				expect(fimHandler).toBeDefined()

				for await (const chunk of fimHandler!.streamFim("prefix", "suffix", undefined, (usage) => {
					receivedUsage = usage
				})) {
					chunks.push(chunk)
				}

				expect(chunks).toEqual(["chunk1", "chunk2"])
				expect(receivedUsage).toEqual({
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				})
				expect(streamSse).toHaveBeenCalledWith(mockResponse)
			})

			it("handles errors correctly", async () => {
				const handler = new KilocodeOpenrouterHandler({
					...mockOptions,
					kilocodeModel: "mistral/codestral-latest",
				})

				const mockResponse = {
					ok: false,
					status: 400,
					statusText: "Bad Request",
					text: vitest.fn().mockResolvedValue("Invalid request"),
				}

				global.fetch = vitest.fn().mockResolvedValue(mockResponse)

				const fimHandler = handler.fimSupport()
				expect(fimHandler).toBeDefined()
				const generator = fimHandler!.streamFim("prefix", "suffix")
				await expect(generator.next()).rejects.toThrow(
					"FIM streaming failed: 400 Bad Request - Invalid request",
				)
			})
		})
	})
})
