import { describe, it, expect, beforeEach, vi } from "vitest"
import { providerCommand } from "../provider.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { CommandContext } from "../core/types.js"
import type { ProviderConfig } from "../../config/types.js"

describe("provider command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let selectProviderMock: ReturnType<typeof vi.fn>

	const mockProviders: ProviderConfig[] = [
		{
			id: "anthropic-main",
			provider: "anthropic",
			apiModelId: "claude-sonnet-4",
		},
		{
			id: "openai-backup",
			provider: "openai-native",
			apiModelId: "gpt-4",
		},
		{
			id: "kilocode-test",
			provider: "kilocode",
			kilocodeModel: "claude-sonnet-4.5",
		},
	]

	beforeEach(() => {
		addMessageMock = vi.fn()
		selectProviderMock = vi.fn().mockResolvedValue(undefined)

		mockContext = createMockContext({
			config: {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "anthropic-main",
				providers: mockProviders,
			},
			currentProvider: mockProviders[0],
			addMessage: addMessageMock,
			selectProvider: selectProviderMock,
		})
	})

	describe("command metadata", () => {
		it("should have correct name and aliases", () => {
			expect(providerCommand.name).toBe("provider")
			expect(providerCommand.aliases).toContain("prov")
		})

		it("should have correct category and priority", () => {
			expect(providerCommand.category).toBe("settings")
			expect(providerCommand.priority).toBe(8)
		})

		it("should have proper usage and examples", () => {
			expect(providerCommand.usage).toBe("/provider [subcommand] [args]")
			expect(providerCommand.examples).toContain("/provider")
			expect(providerCommand.examples).toContain("/provider list")
			expect(providerCommand.examples).toContain("/provider select my-anthropic")
		})
	})

	describe("showing current provider", () => {
		it("should show current provider information when no arguments provided", async () => {
			await providerCommand.handler({
				...mockContext,
				args: [],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Current Provider:"),
				}),
			)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("ID: anthropic-main")
			expect(message.content).toContain("Type: Anthropic")
			expect(message.content).toContain("Model: claude-sonnet-4")
			expect(message.content).toContain("Total Configured: 3")
		})

		it("should show error when no provider is configured", async () => {
			await providerCommand.handler({
				...mockContext,
				currentProvider: null,
				args: [],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("No provider configured"),
				}),
			)
		})

		it("should show commands help in current provider view", async () => {
			await providerCommand.handler({
				...mockContext,
				args: [],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("/provider list")
			expect(message.content).toContain("/provider select")
		})
	})

	describe("listing providers", () => {
		it("should list all configured providers", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["list"],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Configured Providers:"),
				}),
			)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("anthropic-main")
			expect(message.content).toContain("openai-backup")
			expect(message.content).toContain("kilocode-test")
			expect(message.content).toContain("**Total:** 3 providers")
		})

		it("should mark current provider with star", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["list"],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("⭐ **anthropic-main** (current)")
		})

		it("should show provider types", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["list"],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Type: Anthropic")
			expect(message.content).toContain("Type: OpenAI")
			expect(message.content).toContain("Type: Kilo Code")
		})

		it("should show model information when available", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["list"],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Model: claude-sonnet-4")
			expect(message.content).toContain("Model: gpt-4")
			expect(message.content).toContain("Model: claude-sonnet-4.5")
		})

		it("should show message when no providers configured", async () => {
			await providerCommand.handler({
				...mockContext,
				config: {
					...mockContext.config,
					providers: [],
				},
				args: ["list"],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("No providers configured"),
				}),
			)
		})

		it("should show usage hint at the end", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["list"],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("/provider select <provider-id>")
		})
	})

	describe("selecting provider", () => {
		it("should show error when provider ID is missing", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["select"],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage: /provider select <provider-id>"),
				}),
			)
		})

		it("should show error when provider not found", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["select", "non-existent"],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining('Provider "non-existent" not found'),
				}),
			)
		})

		it("should show success message when provider is selected", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["select", "openai-backup"],
			})

			// Should call selectProvider
			expect(selectProviderMock).toHaveBeenCalledWith("openai-backup")

			// Should show success message
			const successCall = addMessageMock.mock.calls.find((call) => call[0].type === "system")
			expect(successCall).toBeDefined()
			if (successCall) {
				expect(successCall[0].content).toContain("Switched to **openai-backup**")
				expect(successCall[0].content).toContain("Type: OpenAI")
				expect(successCall[0].content).toContain("Model: gpt-4")
			}
		})
	})

	describe("unknown subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["unknown"],
			})

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining('Unknown subcommand "unknown"'),
				}),
			)
		})

		it("should list available subcommands in error", async () => {
			await providerCommand.handler({
				...mockContext,
				args: ["invalid"],
			})

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Available: list, select")
		})
	})

	describe("argument definitions", () => {
		it("should have subcommand argument with correct values", () => {
			const subcommandArg = providerCommand.arguments?.find((arg) => arg.name === "subcommand")
			expect(subcommandArg).toBeDefined()
			expect(subcommandArg?.required).toBe(false)
			expect(subcommandArg?.values).toContainEqual(
				expect.objectContaining({
					value: "list",
					description: "List all configured providers",
				}),
			)
			expect(subcommandArg?.values).toContainEqual(
				expect.objectContaining({
					value: "select",
					description: "Switch to a different provider",
				}),
			)
		})

		it("should have provider-id argument with conditional provider", () => {
			const providerIdArg = providerCommand.arguments?.find((arg) => arg.name === "provider-id")
			expect(providerIdArg).toBeDefined()
			expect(providerIdArg?.required).toBe(false)
			expect(providerIdArg?.conditionalProviders).toBeDefined()
			expect(providerIdArg?.conditionalProviders?.length).toBeGreaterThan(0)
		})
	})
})
