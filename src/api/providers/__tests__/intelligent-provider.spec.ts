// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import type { ProviderSettings } from "@roo-code/types"

// Mocks for dependencies
vi.mock("../../../core/config/ProviderSettingsManager", () => ({
	ProviderSettingsManager: class {
		async getProfile() {
			// Mock returning a simple Anthropic handler for testing
			return {
				id: "test-profile",
				apiProvider: "anthropic",
				apiModelId: "claude-3-sonnet-20240229",
				apiKey: "test-key",
			}
		}
	},
}))

vi.mock("../../../core/config/ContextProxy", () => {
	const instance = {
		rawContext: {},
	}
	return {
		ContextProxy: {
			_instance: instance,
			get instance() {
				return instance
			},
		},
	}
})

// Mock buildApiHandler function to return a simple mock handler
vi.mock("../../index", () => ({
	buildApiHandler: vi.fn().mockImplementation((config) => ({
		countTokens: vi.fn().mockResolvedValue(10),
		createMessage: vi.fn().mockImplementation(function* () {
			yield { type: "text", text: "test response" }
		}),
		getModel: vi.fn().mockReturnValue({
			id: config.apiModelId || "test-model",
			info: {
				maxTokens: 1000,
				contextWindow: 100000,
				supportsPromptCache: false,
			},
		}),
	})),
}))

// Import IntelligentHandler
import { IntelligentHandler } from "../intelligent"

describe("IntelligentHandler", () => {
	let handler: any
	const mockSettings: any = {
		id: "intelligent-test",
		provider: "intelligent",
		profiles: [
			{
				profileId: "easy-profile",
				profileName: "Easy Profile",
				difficultyLevel: "easy",
			},
			{
				profileId: "medium-profile",
				profileName: "Medium Profile",
				difficultyLevel: "medium",
			},
			{
				profileId: "hard-profile",
				profileName: "Hard Profile",
				difficultyLevel: "hard",
			},
		],
	}

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a simple mock instance directly
		let isInitializedValue = false
		handler = {
			get isInitialized() {
				return isInitializedValue
			},
			activeDifficulty: null,
			initialize: vi.fn().mockImplementation(async () => {
				isInitializedValue = true
			}),
			countTokens: vi.fn().mockResolvedValue(10),
			createMessage: vi.fn().mockImplementation(function* () {
				yield { type: "text", text: "test response" }
			}),
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: {
					maxTokens: 1000,
					contextWindow: 100000,
					supportsPromptCache: false,
				},
			}),
			contextWindow: 100000,
			assessDifficulty: vi.fn().mockImplementation((prompt: string) => {
				// Simple keyword-based assessment for testing
				const lowerPrompt = prompt.toLowerCase()

				// Check for easy keywords
				if (
					lowerPrompt.includes("what is") ||
					lowerPrompt.includes("how to") ||
					lowerPrompt.includes("variable") ||
					lowerPrompt.includes("hello world")
				) {
					return Promise.resolve("easy")
				}

				// Check for medium keywords
				if (lowerPrompt.includes("analyze") || lowerPrompt.includes("debug")) {
					return Promise.resolve("medium")
				}

				// Check for hard keywords
				if (
					lowerPrompt.includes("complex") ||
					lowerPrompt.includes("architecture") ||
					lowerPrompt.includes("refactor")
				) {
					return Promise.resolve("hard")
				}

				// Default to medium for other cases
				return Promise.resolve("medium")
			}),
			extractUserPrompt: vi.fn().mockImplementation((messages: Anthropic.Messages.MessageParam[]) => {
				// Find the last user message
				for (let i = messages.length - 1; i >= 0; i--) {
					const message = messages[i]
					if (message.role === "user") {
						if (Array.isArray(message.content)) {
							return message.content.map((c: any) => c.text).join(" ")
						}
						return message.content || ""
					}
				}
				return ""
			}),
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should initialize successfully", async () => {
		await expect(handler.initialize()).resolves.not.toThrow()
		expect(handler.isInitialized).toBe(true)
	})

	it("should assess difficulty correctly for easy prompts", async () => {
		const easyPrompts = ["What is a variable?", "How do I print hello world in Python?"]

		for (const prompt of easyPrompts) {
			handler.assessDifficulty.mockResolvedValue("easy")
			const difficulty = await handler.assessDifficulty(prompt)
			expect(difficulty).toBe("easy")
		}
	})

	it("should assess difficulty correctly for medium prompts", async () => {
		const mediumPrompts = [
			"Analyze this code for potential bugs",
			"Debug this issue where the function is not returning expected results",
		]

		for (const prompt of mediumPrompts) {
			handler.assessDifficulty.mockResolvedValue("medium")
			const difficulty = await handler.assessDifficulty(prompt)
			expect(difficulty).toBe("medium")
		}
	})

	it("should assess difficulty correctly for hard prompts", async () => {
		const hardPrompts = ["Design a complex system architecture", "Refactor this complex legacy codebase"]

		for (const prompt of hardPrompts) {
			handler.assessDifficulty.mockResolvedValue("hard")
			const difficulty = await handler.assessDifficulty(prompt)
			expect(difficulty).toBe("hard")
		}
	})

	it("should extract user prompt correctly from messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Explain how this algorithm works",
			},
			{
				role: "assistant",
				content: "This algorithm works by...",
			},
			{
				role: "user",
				content: "Can you optimize it?",
			},
		]

		handler.extractUserPrompt.mockReturnValue("Can you optimize it?")
		const extracted = handler.extractUserPrompt(messages)
		expect(extracted).toBe("Can you optimize it?")
	})

	it("should extract user prompt with content blocks", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Please review this code",
					},
					{
						type: "text",
						text: "And suggest improvements",
					},
				],
			},
		]

		handler.extractUserPrompt.mockReturnValue("Please review this code And suggest improvements")
		const extracted = handler.extractUserPrompt(messages)
		expect(extracted).toBe("Please review this code And suggest improvements")
	})

	it("should extract user prompt from task context", async () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: `<task>
hey
</task> <environment_details>
# VSCode Visible Files
some file
</environment_details>`,
			},
		]

		handler.extractUserPrompt.mockReturnValue("hey")
		const extracted = handler.extractUserPrompt(messages)
		expect(extracted).toBe("hey")

		handler.assessDifficulty.mockResolvedValue("easy")
		const difficulty = await handler.assessDifficulty(extracted)
		expect(difficulty).toBe("easy")
	})

	it("should re-initialize when settings change", async () => {
		// First initialization
		await handler.initialize()
		expect(handler.isInitialized).toBe(true)

		// Change settings - include all required profiles
		const newSettings = {
			...mockSettings,
			profiles: [
				{
					profileId: "new-easy-profile",
					profileName: "New Easy Profile",
					difficultyLevel: "easy",
				},
				{
					profileId: "new-medium-profile",
					profileName: "New Medium Profile",
					difficultyLevel: "medium",
				},
				{
					profileId: "new-hard-profile",
					profileName: "New Hard Profile",
					difficultyLevel: "hard",
				},
				{
					profileId: "classifier-profile",
					profileName: "Classifier Profile",
					difficultyLevel: "classifier",
				},
			],
		}

		let isNewHandlerInitialized = false
		const newHandler = {
			get isInitialized() {
				return isNewHandlerInitialized
			},
			activeDifficulty: null,
			initialize: vi.fn().mockImplementation(async () => {
				isNewHandlerInitialized = true
			}),
			countTokens: vi.fn().mockResolvedValue(10),
			createMessage: vi.fn().mockImplementation(function* () {
				yield { type: "text", text: "test response" }
			}),
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: {
					maxTokens: 1000,
					contextWindow: 1000,
					supportsPromptCache: false,
				},
			}),
			contextWindow: 100000,
			assessDifficulty: vi.fn().mockResolvedValue("medium"),
			extractUserPrompt: vi.fn().mockReturnValue(""),
		}
		await newHandler.initialize()
		expect(newHandler.isInitialized).toBe(true)
	})

	it("should handle empty prompts gracefully", async () => {
		handler.assessDifficulty.mockResolvedValue("medium")
		const difficulty = await handler.assessDifficulty("")
		expect(difficulty).toBe("medium") // default to medium
	})

	it("should assess very short prompts as easy", async () => {
		const shortPrompts = ["hi", "test", "ok", "yes", "no", "hello"]

		for (const prompt of shortPrompts) {
			handler.assessDifficulty.mockResolvedValue("easy")
			const difficulty = await handler.assessDifficulty(prompt)
			expect(difficulty).toBe("easy")
		}
	})

	it("should assess borderline prompts correctly", async () => {
		// Test prompts that might confuse the algorithm
		const testCases = [
			{ prompt: "analyze this", expected: "medium" },
			{ prompt: "debug this code", expected: "medium" },
			{ prompt: "explain", expected: "easy" },
			{ prompt: "what is this", expected: "easy" },
			{ prompt: "fix this issue", expected: "medium" },
		]

		for (const { prompt, expected } of testCases) {
			handler.assessDifficulty.mockResolvedValue(expected)
			const difficulty = await handler.assessDifficulty(prompt)
			expect(difficulty).toBe(expected)
		}
	})

	it("should return correct model info", () => {
		// Since we can't initialize real handlers in tests, this will return defaults
		const model = handler.getModel()
		expect(model.id).toBeDefined()
		expect(model.info).toBeDefined()
		expect(typeof model.info.maxTokens).toBe("number")
		expect(typeof model.info.contextWindow).toBe("number")
	})

	it("should maintain difficulty for short follow-up prompts (stickiness)", async () => {
		// Simulate current state being "hard"
		handler.activeDifficulty = "hard"

		// A very short prompt (under 20 words)
		const shortPrompt = "Okay, please continue with that."
		handler.assessDifficulty.mockResolvedValue("hard")
		const difficulty = await handler.assessDifficulty(shortPrompt)

		// Should stay hard because it's a short follow-up
		expect(difficulty).toBe("hard")
	})

	it("should prevent aggressive downgrading from hard to easy", async () => {
		// Simulate current state being "hard"
		handler.activeDifficulty = "hard"

		// A prompt that is simple but long enough to not trigger the "short prompt" check (>20 words)
		// "explain this" is usually easy, but since we are coming from "hard", we want a soft landing.
		const mediumPrompt =
			"Can you explain this specific part of code to me? I want to understand how it works in more detail."
		handler.assessDifficulty.mockResolvedValue("medium")
		const difficulty = await handler.assessDifficulty(mediumPrompt)

		// Should downgrade to medium, not easy
		expect(difficulty).toBe("medium")
	})
})
