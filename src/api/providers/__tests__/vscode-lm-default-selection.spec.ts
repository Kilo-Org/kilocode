import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { VsCodeLmHandler } from "../vscode-lm"

// Mock vscode module
vi.mock("vscode", () => ({
	lm: {
		selectChatModels: vi.fn(),
	},
	workspace: {
		onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
	},
	LanguageModelChatMessage: {
		Assistant: vi.fn((content) => ({ role: "assistant", content })),
		User: vi.fn((content) => ({ role: "user", content })),
	},
	LanguageModelTextPart: vi.fn(),
	CancellationTokenSource: vi.fn(() => ({
		token: {},
		cancel: vi.fn(),
		dispose: vi.fn(),
	})),
}))

describe("VsCodeLmHandler Default Model Selection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should select GPT-4 model when available and no specific selector provided", async () => {
		const mockModels = [
			{
				id: "copilot-gpt-3.5-turbo",
				name: "GPT-3.5 Turbo",
				vendor: "copilot",
				family: "gpt-3.5",
				version: "1.0",
				maxInputTokens: 4096,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
			{
				id: "copilot-gpt-4",
				name: "GPT-4",
				vendor: "copilot",
				family: "gpt-4",
				version: "1.0",
				maxInputTokens: 8192,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
			{
				id: "copilot-gpt-4-turbo",
				name: "GPT-4 Turbo",
				vendor: "copilot",
				family: "gpt-4",
				version: "1.0",
				maxInputTokens: 128000,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
		]

		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(mockModels as any)

		const handler = new VsCodeLmHandler({})
		const client = await handler.createClient({})

		// Should select GPT-4 Turbo (newest GPT-4 model based on sorting)
		expect(client.id).toBe("copilot-gpt-4-turbo")
		expect(client.family).toBe("gpt-4")
	})

	it("should select GPT-3.5 model when no GPT-4 available", async () => {
		const mockModels = [
			{
				id: "copilot-gpt-3.5-turbo",
				name: "GPT-3.5 Turbo",
				vendor: "copilot",
				family: "gpt-3.5",
				version: "1.0",
				maxInputTokens: 4096,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
			{
				id: "some-other-model",
				name: "Other Model",
				vendor: "copilot",
				family: "other",
				version: "1.0",
				maxInputTokens: 2048,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
		]

		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(mockModels as any)

		const handler = new VsCodeLmHandler({})
		const client = await handler.createClient({})

		// Should select GPT-3.5 model
		expect(client.id).toBe("copilot-gpt-3.5-turbo")
		expect(client.family).toBe("gpt-3.5")
	})

	it("should select first available model when no GPT models available", async () => {
		const mockModels = [
			{
				id: "some-model",
				name: "Some Model",
				vendor: "copilot",
				family: "other",
				version: "1.0",
				maxInputTokens: 2048,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
			{
				id: "another-model",
				name: "Another Model",
				vendor: "copilot",
				family: "different",
				version: "1.0",
				maxInputTokens: 4096,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
		]

		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(mockModels as any)

		const handler = new VsCodeLmHandler({})
		const client = await handler.createClient({})

		// Should select first available model
		expect(client.id).toBe("some-model")
		expect(client.family).toBe("other")
	})

	it("should respect specific selector when provided", async () => {
		const mockModels = [
			{
				id: "specific-model",
				name: "Specific Model",
				vendor: "copilot",
				family: "specific",
				version: "1.0",
				maxInputTokens: 8192,
				sendRequest: vi.fn(),
				countTokens: vi.fn(),
			},
		]

		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(mockModels as any)

		const handler = new VsCodeLmHandler({})
		const client = await handler.createClient({ family: "specific" })

		// Should use the model returned by the specific selector
		expect(client.id).toBe("specific-model")
		expect(client.family).toBe("specific")
	})

	it("should create fallback model when no models available", async () => {
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([])

		const handler = new VsCodeLmHandler({})
		const client = await handler.createClient({})

		// Should create fallback model
		expect(client.id).toBe("default-lm")
		expect(client.name).toBe("Default Language Model")
		expect(client.vendor).toBe("vscode")
	})
})
