/**
 * Tests for the /mode command
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { modeCommand } from "../mode.js"
import type { CommandContext } from "../core/types.js"
import type { ModeConfig } from "../../types/messages.js"

describe("modeCommand", () => {
	let mockContext: CommandContext
	let mockAddMessage: ReturnType<typeof vi.fn>
	let mockSetMode: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockAddMessage = vi.fn()
		mockSetMode = vi.fn()

		mockContext = {
			input: "/mode",
			args: [],
			options: {},
			config: {} as CommandContext["config"],
			sendMessage: vi.fn().mockResolvedValue(undefined),
			addMessage: mockAddMessage,
			clearMessages: vi.fn(),
			replaceMessages: vi.fn(),
			setMessageCutoffTimestamp: vi.fn(),
			clearTask: vi.fn().mockResolvedValue(undefined),
			setMode: mockSetMode,
			setTheme: vi.fn().mockResolvedValue(undefined),
			exit: vi.fn(),
			setCommittingParallelMode: vi.fn(),
			isParallelMode: false,
			routerModels: null,
			currentProvider: null,
			kilocodeDefaultModel: "",
			updateProviderModel: vi.fn().mockResolvedValue(undefined),
			refreshRouterModels: vi.fn().mockResolvedValue(undefined),
			updateProvider: vi.fn().mockResolvedValue(undefined),
			selectProvider: vi.fn().mockResolvedValue(undefined),
			profileData: null,
			balanceData: null,
			profileLoading: false,
			balanceLoading: false,
			customModes: [],
			taskHistoryData: null,
			taskHistoryFilters: {
				workspace: "current",
				sort: "newest",
				favoritesOnly: false,
			},
			taskHistoryLoading: false,
			taskHistoryError: null,
			fetchTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistoryFilters: vi.fn().mockResolvedValue(null),
			changeTaskHistoryPage: vi.fn().mockResolvedValue(null),
			nextTaskHistoryPage: vi.fn().mockResolvedValue(null),
			previousTaskHistoryPage: vi.fn().mockResolvedValue(null),
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
			refreshTerminal: vi.fn().mockResolvedValue(undefined),
			chatMessages: [],
		}
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(modeCommand.name).toBe("mode")
		})

		it("should have correct aliases", () => {
			expect(modeCommand.aliases).toEqual(["m"])
		})

		it("should have correct description", () => {
			expect(modeCommand.description).toBe("Switch to a different mode")
		})

		it("should have correct usage", () => {
			expect(modeCommand.usage).toBe("/mode <mode-name>")
		})

		it("should have correct category", () => {
			expect(modeCommand.category).toBe("settings")
		})

		it("should have examples", () => {
			expect(modeCommand.examples).toEqual(["/mode code", "/mode architect", "/mode debug"])
		})

		it("should have correct priority", () => {
			expect(modeCommand.priority).toBe(9)
		})

		it("should have arguments defined", () => {
			expect(modeCommand.arguments).toBeDefined()
			expect(modeCommand.arguments?.length).toBe(1)
			expect(modeCommand.arguments?.[0].name).toBe("mode-name")
			expect(modeCommand.arguments?.[0].required).toBe(true)
		})
	})

	describe("handler - no arguments", () => {
		it("should list available default modes when no arguments provided", async () => {
			mockContext.args = []

			await modeCommand.handler(mockContext)

			expect(mockAddMessage).toHaveBeenCalledTimes(1)
			const message = mockAddMessage.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("**Available Modes:**")
			expect(message.content).toContain("architect")
			expect(message.content).toContain("code")
			expect(message.content).toContain("ask")
			expect(message.content).toContain("debug")
			expect(message.content).toContain("orchestrator")
		})

		it("should show mode descriptions", async () => {
			mockContext.args = []

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.content).toContain("(architect)")
			expect(message.content).toContain("Plan and design before implementation")
			expect(message.content).toContain("(code)")
			expect(message.content).toContain("Write, modify, and refactor code")
		})

		it("should show source labels for global modes", async () => {
			mockContext.args = []

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.content).toContain("(global)")
		})

		it("should not call setMode when no arguments", async () => {
			mockContext.args = []

			await modeCommand.handler(mockContext)

			expect(mockSetMode).not.toHaveBeenCalled()
		})
	})

	describe("handler - with arguments", () => {
		it("should switch to valid mode", async () => {
			mockContext.args = ["code"]

			await modeCommand.handler(mockContext)

			expect(mockSetMode).toHaveBeenCalledWith("code")
		})

		it("should show success message when switching mode", async () => {
			mockContext.args = ["architect"]

			await modeCommand.handler(mockContext)

			expect(mockAddMessage).toHaveBeenCalledTimes(1)
			const message = mockAddMessage.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Switched to **Architect** mode")
		})

		it("should be case-insensitive", async () => {
			mockContext.args = ["CODE"]

			await modeCommand.handler(mockContext)

			expect(mockSetMode).toHaveBeenCalledWith("code")
		})

		it("should show error for invalid mode", async () => {
			mockContext.args = ["invalid-mode"]

			await modeCommand.handler(mockContext)

			expect(mockAddMessage).toHaveBeenCalledTimes(1)
			const message = mockAddMessage.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain('Invalid mode "invalid-mode"')
			expect(message.content).toContain("Available modes:")
		})

		it("should not call setMode for invalid mode", async () => {
			mockContext.args = ["invalid-mode"]

			await modeCommand.handler(mockContext)

			expect(mockSetMode).not.toHaveBeenCalled()
		})

		it("should work with all default modes", async () => {
			const modes = ["architect", "code", "ask", "debug", "orchestrator"]

			for (const mode of modes) {
				mockAddMessage.mockClear()
				mockSetMode.mockClear()
				mockContext.args = [mode]

				await modeCommand.handler(mockContext)

				expect(mockSetMode).toHaveBeenCalledWith(mode)
			}
		})
	})

	describe("handler - custom modes", () => {
		it("should include custom modes in available list", async () => {
			const customMode: ModeConfig = {
				slug: "custom",
				name: "Custom Mode",
				description: "A custom mode",
				source: "project",
			}
			mockContext.customModes = [customMode]
			mockContext.args = []

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.content).toContain("custom")
			expect(message.content).toContain("Custom Mode")
			expect(message.content).toContain("(project)")
		})

		it("should switch to custom mode", async () => {
			const customMode: ModeConfig = {
				slug: "custom",
				name: "Custom Mode",
				description: "A custom mode",
				source: "project",
			}
			mockContext.customModes = [customMode]
			mockContext.args = ["custom"]

			await modeCommand.handler(mockContext)

			expect(mockSetMode).toHaveBeenCalledWith("custom")
		})

		it("should show custom mode in success message", async () => {
			const customMode: ModeConfig = {
				slug: "custom",
				name: "Custom Mode",
				description: "A custom mode",
				source: "project",
			}
			mockContext.customModes = [customMode]
			mockContext.args = ["custom"]

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.content).toContain("Switched to **Custom Mode** mode")
		})

		it("should show organization source label", async () => {
			const orgMode: ModeConfig = {
				slug: "org-mode",
				name: "Org Mode",
				description: "An org mode",
				source: "organization",
			}
			mockContext.customModes = [orgMode]
			mockContext.args = []

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.content).toContain("org-mode")
		})

		it("should mix default and custom modes", async () => {
			const customMode: ModeConfig = {
				slug: "custom",
				name: "Custom Mode",
				description: "A custom mode",
				source: "project",
			}
			mockContext.customModes = [customMode]
			mockContext.args = []

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			const content = message.content

			// Should have all default modes
			expect(content).toContain("architect")
			expect(content).toContain("code")
			expect(content).toContain("ask")
			expect(content).toContain("debug")
			expect(content).toContain("orchestrator")

			// Should have custom mode
			expect(content).toContain("custom")
		})
	})

	describe("message structure", () => {
		it("should have valid message structure", async () => {
			mockContext.args = ["code"]

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message).toHaveProperty("id")
			expect(message).toHaveProperty("type")
			expect(message).toHaveProperty("content")
			expect(message).toHaveProperty("ts")
			expect(typeof message.id).toBe("string")
			expect(typeof message.type).toBe("string")
			expect(typeof message.content).toBe("string")
			expect(typeof message.ts).toBe("number")
		})

		it("should use current timestamp", async () => {
			mockContext.args = ["code"]
			const beforeTime = Date.now()

			await modeCommand.handler(mockContext)

			const message = mockAddMessage.mock.calls[0][0]
			expect(message.ts).toBeGreaterThanOrEqual(beforeTime)
			expect(message.ts).toBeLessThanOrEqual(Date.now())
		})
	})
})
