/**
 * Tests for the /model command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { modelCommand } from "../model.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { CommandContext } from "../core/types.js"
import type { RouterModels } from "../../types/messages.js"
import type { ProviderConfig } from "../../config/types.js"
import type { ModelRecord } from "../../constants/providers/models.js"

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

	// Create many models for pagination testing
	const createManyModels = (count: number): ModelRecord => {
		const models: ModelRecord = {}
		for (let i = 1; i <= count; i++) {
			models[`model-${i}`] = {
				contextWindow: 100000 + i * 1000,
				supportsPromptCache: i % 2 === 0,
				supportsImages: i % 3 === 0,
				inputPrice: i * 0.5,
				outputPrice: i * 1.0,
				displayName: `Model ${i}`,
			}
		}
		return models
	}

	beforeEach(() => {
		addMessageMock = vi.fn()
		updateProviderModelMock = vi.fn().mockResolvedValue(undefined)

		mockContext = createMockContext({
			input: "/model",
			args: [],
			routerModels: mockRouterModels,
			currentProvider: mockProvider,
			kilocodeDefaultModel: "",
			updateProviderModel: updateProviderModelMock,
			addMessage: addMessageMock,
		})
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
			expect(modelCommand.arguments).toHaveLength(3)
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
			expect(message.content).toContain("Switched to")
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
			// Mock updateModelListFilters to actually update the filters
			const updateFiltersMock = vi.fn((filters) => {
				mockContext.modelListFilters = { ...mockContext.modelListFilters, ...filters }
			})
			mockContext.updateModelListFilters = updateFiltersMock
			mockContext.args = ["list", "gpt-4"]

			await modelCommand.handler(mockContext)

			// Verify the filter was persisted
			expect(updateFiltersMock).toHaveBeenCalledWith({ search: "gpt-4" })

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain('Search: "gpt-4"')
			expect(message.content).toContain("gpt-4")
			expect(message.content).not.toContain("gpt-3.5-turbo")
		})

		it("should show message when no models match filter", async () => {
			// Mock updateModelListFilters to actually update the filters
			const updateFiltersMock = vi.fn((filters) => {
				mockContext.modelListFilters = { ...mockContext.modelListFilters, ...filters }
			})
			mockContext.updateModelListFilters = updateFiltersMock
			mockContext.args = ["list", "nonexistent"]

			await modelCommand.handler(mockContext)

			// Verify the filter was persisted
			expect(updateFiltersMock).toHaveBeenCalledWith({ search: "nonexistent" })

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No models found")
		})

		it("should display model count with pagination", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Showing 1-2 of 2")
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

	describe("Model list pagination", () => {
		beforeEach(() => {
			mockContext.routerModels = {
				...mockRouterModels,
				openrouter: createManyModels(25),
			}
			mockContext.args = ["list"]
		})

		it("should paginate results with 10 items per page", async () => {
			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Showing 1-10 of 25")
			expect(message.content).toContain("Page 1/3")
		})

		it("should navigate to specific page", async () => {
			mockContext.args = ["list", "page", "2"]

			await modelCommand.handler(mockContext)

			expect(mockContext.changeModelListPage).toHaveBeenCalledWith(1)
		})

		it("should go to next page", async () => {
			mockContext.args = ["list", "next"]
			mockContext.modelListPageIndex = 0

			await modelCommand.handler(mockContext)

			expect(mockContext.changeModelListPage).toHaveBeenCalledWith(1)
		})

		it("should go to previous page", async () => {
			mockContext.args = ["list", "prev"]
			mockContext.modelListPageIndex = 1

			await modelCommand.handler(mockContext)

			expect(mockContext.changeModelListPage).toHaveBeenCalledWith(0)
		})

		it("should show error when already on first page", async () => {
			mockContext.args = ["list", "prev"]
			mockContext.modelListPageIndex = 0

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Already on the first page")
		})

		it("should show error when already on last page", async () => {
			mockContext.args = ["list", "next"]
			mockContext.modelListPageIndex = 2

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Already on the last page")
		})

		it("should validate page number", async () => {
			mockContext.args = ["list", "page", "invalid"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Invalid page number")
		})

		it("should validate page number is within range", async () => {
			mockContext.args = ["list", "page", "10"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Must be between 1 and")
		})
	})

	describe("Model list sorting", () => {
		beforeEach(() => {
			mockContext.args = ["list"]
		})

		it("should sort by name", async () => {
			mockContext.args = ["list", "sort", "name"]

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({ sort: "name" })
		})

		it("should sort by context window", async () => {
			mockContext.args = ["list", "sort", "context"]

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({ sort: "context" })
		})

		it("should sort by price", async () => {
			mockContext.args = ["list", "sort", "price"]

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({ sort: "price" })
		})

		it("should show error for invalid sort option", async () => {
			mockContext.args = ["list", "sort", "invalid"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Invalid sort option")
		})

		it("should show error when sort option is missing", async () => {
			mockContext.args = ["list", "sort"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /model list sort")
		})
	})

	describe("Model list filtering", () => {
		beforeEach(() => {
			mockContext.args = ["list"]
		})

		it("should filter by images capability", async () => {
			mockContext.args = ["list", "filter", "images"]

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({
				capabilities: ["images"],
			})
		})

		it("should filter by cache capability", async () => {
			mockContext.args = ["list", "filter", "cache"]

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({
				capabilities: ["cache"],
			})
		})

		it("should toggle filter off when already active", async () => {
			mockContext.args = ["list", "filter", "images"]
			mockContext.modelListFilters = {
				sort: "preferred",
				capabilities: ["images"],
			}

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({
				capabilities: [],
			})
		})

		it("should clear all filters", async () => {
			mockContext.args = ["list", "filter", "all"]
			mockContext.modelListFilters = {
				sort: "preferred",
				capabilities: ["images", "cache"],
			}

			await modelCommand.handler(mockContext)

			expect(mockContext.updateModelListFilters).toHaveBeenCalledWith({
				capabilities: [],
			})
		})

		it("should show error for invalid filter option", async () => {
			mockContext.args = ["list", "filter", "invalid"]

			await modelCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Invalid filter option")
		})
	})
})
