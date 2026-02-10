/**
 * Tests for /checkpoint command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkpointCommand } from "../checkpoint.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the generateMessage utility
vi.mock("../../ui/utils/messages.js", () => ({
	generateMessage: vi.fn(() => ({
		id: "mock-id",
		ts: Date.now(),
	})),
}))

// Mock the logs service
vi.mock("../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("/checkpoint command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let sendWebviewMessageMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		addMessageMock = vi.fn()
		sendWebviewMessageMock = vi.fn().mockResolvedValue(undefined)

		mockContext = createMockContext({
			input: "/checkpoint",
			addMessage: addMessageMock,
			sendWebviewMessage: sendWebviewMessageMock,
			chatMessages: [],
		})
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(checkpointCommand.name).toBe("checkpoint")
		})

		it("should have correct aliases", () => {
			expect(checkpointCommand.aliases).toEqual(["cp"])
		})

		it("should have correct description", () => {
			expect(checkpointCommand.description).toBe("Manage and revert to saved checkpoints")
		})

		it("should have correct category", () => {
			expect(checkpointCommand.category).toBe("chat")
		})

		it("should have correct priority", () => {
			expect(checkpointCommand.priority).toBe(7)
		})

		it("should have correct usage", () => {
			expect(checkpointCommand.usage).toBe("/checkpoint <list|restore|enable|disable> [hash]")
		})

		it("should have examples including enable and disable", () => {
			expect(checkpointCommand.examples).toContain("/checkpoint list")
			expect(checkpointCommand.examples).toContain("/checkpoint restore 41db173a")
			expect(checkpointCommand.examples).toContain("/checkpoint enable")
			expect(checkpointCommand.examples).toContain("/checkpoint disable")
		})

		it("should have arguments defined", () => {
			expect(checkpointCommand.arguments).toBeDefined()
			expect(checkpointCommand.arguments).toHaveLength(2)
		})

		it("should have subcommand argument", () => {
			const subcommandArg = checkpointCommand.arguments?.[0]
			expect(subcommandArg?.name).toBe("subcommand")
			expect(subcommandArg?.required).toBe(false)
			expect(subcommandArg?.provider).toBeDefined()
		})

		it("should have hash argument", () => {
			const hashArg = checkpointCommand.arguments?.[1]
			expect(hashArg?.name).toBe("hash")
			expect(hashArg?.required).toBe(false)
			expect(hashArg?.provider).toBeDefined()
		})
	})

	describe("Display help (no args)", () => {
		it("should display help when no subcommand provided", async () => {
			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Checkpoint Management")
			expect(message.content).toContain("list")
			expect(message.content).toContain("restore")
			expect(message.content).toContain("enable")
			expect(message.content).toContain("disable")
		})

		it("should include enable and disable in help text", async () => {
			await checkpointCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("enable")
			expect(message.content).toContain("Enable checkpoint creation")
			expect(message.content).toContain("disable")
			expect(message.content).toContain("Disable checkpoint creation")
		})
	})

	describe("Enable subcommand", () => {
		it("should enable checkpoints via updateSettings message", async () => {
			mockContext.args = ["enable"]

			await checkpointCommand.handler(mockContext)

			expect(sendWebviewMessageMock).toHaveBeenCalledTimes(1)
			expect(sendWebviewMessageMock).toHaveBeenCalledWith({
				type: "updateSettings",
				updatedSettings: { enableCheckpoints: true },
			})
		})

		it("should display success message when enabling checkpoints", async () => {
			mockContext.args = ["enable"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Checkpoints **enabled**")
		})

		it("should handle errors when enabling checkpoints", async () => {
			const error = new Error("Failed to update settings")
			sendWebviewMessageMock.mockRejectedValue(error)
			mockContext.args = ["enable"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to enable checkpoints")
			expect(message.content).toContain("Failed to update settings")
		})
	})

	describe("Disable subcommand", () => {
		it("should disable checkpoints via updateSettings message", async () => {
			mockContext.args = ["disable"]

			await checkpointCommand.handler(mockContext)

			expect(sendWebviewMessageMock).toHaveBeenCalledTimes(1)
			expect(sendWebviewMessageMock).toHaveBeenCalledWith({
				type: "updateSettings",
				updatedSettings: { enableCheckpoints: false },
			})
		})

		it("should display success message when disabling checkpoints", async () => {
			mockContext.args = ["disable"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Checkpoints **disabled**")
		})

		it("should include note about existing checkpoints when disabling", async () => {
			mockContext.args = ["disable"]

			await checkpointCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Existing checkpoints")
			expect(message.content).toContain("manually deleted")
			// Should contain a path (either Unix or Windows style)
			expect(message.content).toMatch(/checkpoints/)
		})

		it("should handle errors when disabling checkpoints", async () => {
			const error = new Error("Failed to update settings")
			sendWebviewMessageMock.mockRejectedValue(error)
			mockContext.args = ["disable"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to disable checkpoints")
			expect(message.content).toContain("Failed to update settings")
		})
	})

	describe("List subcommand", () => {
		it("should show no checkpoints message when empty", async () => {
			mockContext.args = ["list"]
			mockContext.chatMessages = []

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No checkpoints available")
		})

		it("should list checkpoints when available", async () => {
			mockContext.args = ["list"]
			mockContext.chatMessages = [
				{
					ts: Date.now() - 60000,
					type: "say",
					say: "checkpoint_saved",
					text: "abc123def456789012345678901234567890abcd",
				},
			]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Available checkpoints")
			expect(message.content).toContain("abc123def456789012345678901234567890abcd")
		})
	})

	describe("Restore subcommand", () => {
		it("should require hash for restore", async () => {
			mockContext.args = ["restore"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Hash required")
		})

		it("should show error for non-existent checkpoint", async () => {
			mockContext.args = ["restore", "nonexistent"]
			mockContext.chatMessages = []

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain('Checkpoint "nonexistent" not found')
		})

		it("should send restore approval request for valid checkpoint", async () => {
			const checkpointHash = "abc123def456789012345678901234567890abcd"
			mockContext.args = ["restore", checkpointHash]
			mockContext.chatMessages = [
				{
					ts: Date.now() - 60000,
					type: "say",
					say: "checkpoint_saved",
					text: checkpointHash,
				},
			]

			await checkpointCommand.handler(mockContext)

			expect(sendWebviewMessageMock).toHaveBeenCalledTimes(1)
			expect(sendWebviewMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "requestCheckpointRestoreApproval",
					payload: expect.objectContaining({
						commitHash: checkpointHash,
					}),
				}),
			)
		})
	})

	describe("Unknown subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["unknown"]

			await checkpointCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain('Unknown command "unknown"')
			expect(message.content).toContain("list, restore, enable, disable")
		})
	})

	describe("Subcommand autocomplete", () => {
		it("should provide subcommand suggestions including enable and disable", async () => {
			const providerFunc = checkpointCommand.arguments?.[0]?.provider

			if (providerFunc) {
				const providerContext = {
					commandName: "checkpoint",
					argumentIndex: 0,
					argumentName: "subcommand",
					currentArgs: [],
					currentOptions: {},
					partialInput: "",
					getArgument: vi.fn(),
					parsedValues: {
						args: {},
						options: {},
					},
					command: checkpointCommand,
					commandContext: mockContext,
				}

				const suggestions = await providerFunc(providerContext)

				expect(Array.isArray(suggestions)).toBe(true)
				expect(suggestions.length).toBe(4)

				const values = suggestions.map((s) => (typeof s === "string" ? s : s.value))
				expect(values).toContain("list")
				expect(values).toContain("restore")
				expect(values).toContain("enable")
				expect(values).toContain("disable")
			}
		})

		it("should filter subcommand suggestions based on partial input", async () => {
			const providerFunc = checkpointCommand.arguments?.[0]?.provider

			if (providerFunc) {
				const providerContext = {
					commandName: "checkpoint",
					argumentIndex: 0,
					argumentName: "subcommand",
					currentArgs: [],
					currentOptions: {},
					partialInput: "en",
					getArgument: vi.fn(),
					parsedValues: {
						args: {},
						options: {},
					},
					command: checkpointCommand,
					commandContext: mockContext,
				}

				const suggestions = await providerFunc(providerContext)

				expect(Array.isArray(suggestions)).toBe(true)
				// Should only match "enable" since it contains "en"
				const values = suggestions.map((s) => (typeof s === "string" ? s : s.value))
				expect(values).toContain("enable")
			}
		})
	})
})
