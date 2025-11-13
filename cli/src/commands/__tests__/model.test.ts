/**
 * Tests for the /model command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { modelCommand } from "../model.js"
import type { CommandContext } from "../core/types.js"
import type { RouterModels } from "../../types/messages.js"
import type { ProviderConfig } from "../../config/types.js"

describe("/model command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let updateProviderModelMock: ReturnType<typeof vi.fn>

	const mockRouterModels: RouterModels = {
		openrouter: {
			"gpt-4": {
				contextWindow: 8192,
				supportsPromptCache: false,
				inputPrice: 30,
				outputPrice: 60,
				displayName: "GPT-4",
				preferredIndex: 0,
			},
			"gpt-3.5-turbo": {
				contextWindow: 16385,
				supportsPromptCache: false,
				inputPrice: 0.5,
				outputPrice: 1.5,
				displayName: "GPT-3.5 Turbo",
			},
		},
		ollama: {},
		lmstudio: {},
		litellm: {},
		glama: {},
		unbound: {},
		requesty: {},
		kilocode: {},
		"io-intelligence": {},
		deepinfra: {},
		"vercel-ai-gateway": {},
		ovhcloud: {},
	}

	const mockProvider: ProviderConfig = {
		id: "test-provider",
		provider: "openrouter",
		openRouterModelId: "gpt-4",
		apiKey: "test-key",
	}

	beforeEach(() => {
		addMessageMock = vi.fn()
		updateProviderModelMock = vi.fn().mockResolvedValue(undefined)

		mockContext = {
			input: "/model",
			args: [],
			options: {},
			sendMessage: vi.fn().mockResolvedValue(undefined),
			addMessage: addMessageMock,
			clearMessages: vi.fn(),
			clearTask: vi.fn().mockResolvedValue(undefined),
			setMode: vi.fn(),
			exit: vi.fn(),
			routerModels: mockRouterModels,
			currentProvider: mockProvider,
			kilocodeDefaultModel: "",
			updateProviderModel: updateProviderModelMock,
			refreshRouterModels: vi.fn().mockResolvedValue(undefined),
		}
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(modelCommand.name).toBe("model")
		})

		it("should have correct aliases", () => {
			expect(modelCommand.aliases).toEqual(["mdl"])
		})

		it("should have correct description", () => {
			expect(modelCommand.description).toBe("View and manage AI models")
		})

		it("should have correct category", () => {
			expect(modelCommand.category).toBe("settings")
		})

		it("should have correct priority", () => {
			expect(modelCommand.priority).toBe(8)
		})

		it("should have correct usage", () => {
			expect(modelCommand.usage).toBe("/model [subcommand] [args]")
		})

		it("should have examples", () => {
			expect(modelCommand.examples).toContain("/model")
			expect(modelCommand.examples).toContain("/model info claude-sonnet-4.5")
			expect(modelCommand.examples).toContain("/model select gpt-4")
			expect(modelCommand.examples).toContain("/model list")
		})

		it("should have arguments defined", () => {
			expect(modelCommand.arguments).toBeDefined()
			expect(modelCommand.arguments).toHaveLength(2)
		})

		it("should have subcommand argument with values", () => {
			const subcommandArg = modelCommand.arguments?.[0]
			expect(subcommandArg?.name).toBe("subcommand")
			expect(subcommandArg?.values).toBeDefined()
			expect(subcommandArg?.values).toHaveLength(3)
		})
	})

	describe("Show current model (no args)", () => {
		it("should display current model information", async () => {
			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Current Configuration")
			expect(message.content).toContain("gpt-4")
			expect(message.content).toContain("Openrouter")
		})

		it("should show error when no provider configured", async () => {
			mockContext.currentProvider = null

			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("No provider configured")
		})

		it("should display model capabilities", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Context Window")
			expect(message.content).toContain("8K tokens")
		})

		it("should show available commands", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("/model info")
			expect(message.content).toContain("/model select")
			expect(message.content).toContain("/model list")
		})
	})

	describe("Model info subcommand", () => {
		beforeEach(() => {
			mockContext.args = ["info", "gpt-4"]
		})

		it("should display detailed model information", async () => {
			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Model: gpt-4")
			expect(message.content).toContain("GPT-4")
			expect(message.content).toContain("Capabilities")
		})

		it("should display pricing information", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Pricing")
			expect(message.content).toContain("$30.00")
			expect(message.content).toContain("$60.00")
		})

		it("should show error for invalid model", async () => {
			mockContext.args = ["info", "invalid-model"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("not found")
		})

		it("should show error when model name is missing", async () => {
			mockContext.args = ["info"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /model info")
		})

		it("should show error when no provider configured", async () => {
			mockContext.currentProvider = null
			mockContext.args = ["info", "gpt-4"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("No provider configured")
		})
	})

	describe("Model select subcommand", () => {
		beforeEach(() => {
			mockContext.args = ["select", "gpt-3.5-turbo"]
		})

		it("should switch to the selected model", async () => {
			await modelCommand.handler(mockContext)

			expect(updateProviderModelMock).toHaveBeenCalledTimes(1)
			expect(updateProviderModelMock).toHaveBeenCalledWith("gpt-3.5-turbo")
		})

		it("should display success message", async () => {
			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("✓ Switched to")
			expect(message.content).toContain("gpt-3.5-turbo")
		})

		it("should show error for invalid model", async () => {
			mockContext.args = ["select", "invalid-model"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("not found")
			expect(updateProviderModelMock).not.toHaveBeenCalled()
		})

		it("should show error when model name is missing", async () => {
			mockContext.args = ["select"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /model select")
		})

		it("should handle update errors gracefully", async () => {
			updateProviderModelMock.mockRejectedValue(new Error("Update failed"))

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to switch model")
			expect(message.content).toContain("Update failed")
		})

		it("should show error when no provider configured", async () => {
			mockContext.currentProvider = null

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("No provider configured")
		})
	})

	describe("Model list subcommand", () => {
		beforeEach(() => {
			mockContext.args = ["list"]
		})

		it("should list all available models", async () => {
			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Available Models")
			expect(message.content).toContain("gpt-4")
			expect(message.content).toContain("gpt-3.5-turbo")
		})

		it("should mark current model", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("gpt-4")
			expect(message.content).toContain("(current)")
		})

		it("should mark preferred models with star", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("⭐")
		})

		it("should filter models when filter is provided", async () => {
			mockContext.args = ["list", "gpt-4"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Filtered by")
			expect(message.content).toContain("gpt-4")
			expect(message.content).not.toContain("gpt-3.5-turbo")
		})

		it("should show message when no models match filter", async () => {
			mockContext.args = ["list", "nonexistent"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No models found")
		})

		it("should display model count", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Total:")
			expect(message.content).toContain("2 models")
		})

		it("should show error when no provider configured", async () => {
			mockContext.currentProvider = null

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("No provider configured")
		})
	})

	describe("Invalid subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["unknown"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Unknown subcommand")
			expect(message.content).toContain("unknown")
		})

		it("should list available subcommands in error", async () => {
			mockContext.args = ["invalid"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("info")
			expect(message.content).toContain("select")
			expect(message.content).toContain("list")
		})
	})

	describe("Integration scenarios", () => {
		it("should work with anthropic provider", async () => {
			mockContext.currentProvider = {
				id: "anthropic-provider",
				provider: "anthropic",
				apiModelId: "claude-sonnet-4.5",
			}
			mockContext.routerModels = null

			await modelCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Anthropic")
		})

		it("should handle empty router models", async () => {
			mockContext.routerModels = {
				openrouter: {},
				ollama: {},
				lmstudio: {},
				litellm: {},
				glama: {},
				unbound: {},
				requesty: {},
				kilocode: {},
				"io-intelligence": {},
				deepinfra: {},
				"vercel-ai-gateway": {},
				ovhcloud: {},
			}
			mockContext.args = ["list"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("No models available")
		})

		it("should work with different command aliases", async () => {
			const inputs = ["/model", "/mdl"]

			for (const input of inputs) {
				addMessageMock.mockClear()
				mockContext.input = input
				mockContext.args = []

				await modelCommand.handler(mockContext)

				expect(addMessageMock).toHaveBeenCalledTimes(1)
			}
		})
	})
})
