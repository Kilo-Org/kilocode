// kilocode_change - new file
// npx vitest run src/api/providers/__tests__/kilocode-openrouter.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { KilocodeOpenrouterHandler } from "../kilocode-openrouter"
import { ApiHandlerOptions } from "../../../shared/api"
import { X_KILOCODE_TASKID, X_KILOCODE_ORGANIZATIONID, X_KILOCODE_PROJECTID } from "../../../shared/kilocode/headers"

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

	describe("customRequestOptions", () => {
		it("includes taskId header when provided in metadata", () => {
			const handler = new KilocodeOpenrouterHandler(mockOptions)
			const result = handler.customRequestOptions({ taskId: "test-task-id", mode: "code" })

			expect(result).toEqual({
				headers: {
					[X_KILOCODE_TASKID]: "test-task-id",
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
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
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
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
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
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
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
					[X_KILOCODE_TASKID]: "test-task-id",
					[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
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
					[X_KILOCODE_TASKID]: "test-task-id",
				},
			})
			expect(result?.headers).not.toHaveProperty(X_KILOCODE_PROJECTID)
		})

		it("returns undefined when no headers are needed", () => {
			const handler = new KilocodeOpenrouterHandler(mockOptions)
			const result = handler.customRequestOptions()

			expect(result).toBeUndefined()
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
				expect.objectContaining({
					headers: {
						[X_KILOCODE_TASKID]: "test-task-id",
						[X_KILOCODE_PROJECTID]: "https://github.com/user/repo.git",
						[X_KILOCODE_ORGANIZATIONID]: "test-org-id",
					},
				}),
			)
		})
	})
})
