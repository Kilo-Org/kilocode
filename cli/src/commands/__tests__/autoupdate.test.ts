/**
 * Tests for the /autoupdate command
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { autoupdateCommand } from "../autoupdate.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the saveConfig function
vi.mock("../../config/persistence.js", () => ({
	saveConfig: vi.fn(),
}))

// Mock the generateMessage function
vi.mock("../../ui/utils/messages.js", () => ({
	generateMessage: vi.fn(() => ({
		id: "test-message-id",
		role: "assistant",
		timestamp: Date.now(),
	})),
}))

import { saveConfig } from "../../config/persistence.js"

describe("autoupdateCommand", () => {
	let mockContext: CommandContext
	let addMessageSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		addMessageSpy = vi.fn()

		mockContext = createMockContext({
			input: "/autoupdate",
			args: [],
			addMessage: addMessageSpy,
			config: {
				providers: [],
				autoUpdate: false,
				lastUpdateCheck: null,
			} as any,
		})
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(autoupdateCommand.name).toBe("autoupdate")
		})

		it("should have correct aliases", () => {
			expect(autoupdateCommand.aliases).toEqual([])
		})

		it("should have correct category", () => {
			expect(autoupdateCommand.category).toBe("settings")
		})

		it("should have description", () => {
			expect(autoupdateCommand.description).toBeTruthy()
			expect(autoupdateCommand.description).toContain("automatic")
		})

		it("should have usage", () => {
			expect(autoupdateCommand.usage).toBe("/autoupdate [on|off]")
		})

		it("should have examples", () => {
			expect(autoupdateCommand.examples).toHaveLength(3)
			expect(autoupdateCommand.examples).toContain("/autoupdate on")
			expect(autoupdateCommand.examples).toContain("/autoupdate off")
			expect(autoupdateCommand.examples).toContain("/autoupdate")
		})

		it("should have arguments defined", () => {
			expect(autoupdateCommand.arguments).toBeDefined()
			expect(autoupdateCommand.arguments).toHaveLength(1)
			expect(autoupdateCommand.arguments?.[0].name).toBe("action")
			expect(autoupdateCommand.arguments?.[0].required).toBe(false)
		})
	})

	describe("handler - check status (no arguments)", () => {
		it("should display current status when enabled", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = []

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is currently enabled.",
				}),
			)
		})

		it("should display current status when disabled", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = []

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is currently disabled.",
				}),
			)
		})

		it("should not call saveConfig when checking status", async () => {
			mockContext.args = []

			await autoupdateCommand.handler(mockContext)

			expect(saveConfig).not.toHaveBeenCalled()
		})

		it("should handle empty args array", async () => {
			mockContext.args = []

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is currently disabled.",
				}),
			)
		})

		it("should handle undefined first arg", async () => {
			mockContext.args = [undefined as any]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is currently disabled.",
				}),
			)
		})
	})

	describe("handler - enable auto-update", () => {
		it("should enable auto-update when 'on' is passed", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(true)
		})

		it("should save config when enabling auto-update", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(saveConfig).toHaveBeenCalledTimes(1)
			expect(saveConfig).toHaveBeenCalledWith(mockContext.config)
		})

		it("should display success message when enabling auto-update", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is now enabled. The CLI will automatically check for updates and update when a new version is available.",
				}),
			)
		})

		it("should handle 'ON' (uppercase)", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["ON"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(true)
		})

		it("should handle 'On' (mixed case)", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["On"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(true)
		})
	})

	describe("handler - disable auto-update", () => {
		it("should disable auto-update when 'off' is passed", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = ["off"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(false)
		})

		it("should save config when disabling auto-update", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = ["off"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(saveConfig).toHaveBeenCalledTimes(1)
			expect(saveConfig).toHaveBeenCalledWith(mockContext.config)
		})

		it("should display success message when disabling auto-update", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = ["off"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Auto-update is now disabled.",
				}),
			)
		})

		it("should handle 'OFF' (uppercase)", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = ["OFF"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(false)
		})

		it("should handle 'Off' (mixed case)", async () => {
			mockContext.config.autoUpdate = true
			mockContext.args = ["Off"]

			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(false)
		})
	})

	describe("handler - invalid arguments", () => {
		it("should display error message for invalid action", async () => {
			mockContext.args = ["invalid"]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: 'Invalid action "invalid". Use "on" to enable or "off" to disable auto-update.',
				}),
			)
		})

		it("should not modify config for invalid action", async () => {
			mockContext.config.autoUpdate = false
			mockContext.args = ["invalid"]

			await autoupdateCommand.handler(mockContext)

			expect(mockContext.config.autoUpdate).toBe(false)
		})

		it("should not call saveConfig for invalid action", async () => {
			mockContext.args = ["invalid"]

			await autoupdateCommand.handler(mockContext)

			expect(saveConfig).not.toHaveBeenCalled()
		})

		it("should handle 'yes' as invalid", async () => {
			mockContext.args = ["yes"]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: 'Invalid action "yes". Use "on" to enable or "off" to disable auto-update.',
				}),
			)
		})

		it("should handle 'no' as invalid", async () => {
			mockContext.args = ["no"]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: 'Invalid action "no". Use "on" to enable or "off" to disable auto-update.',
				}),
			)
		})

		it("should handle 'true' as invalid", async () => {
			mockContext.args = ["true"]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: 'Invalid action "true". Use "on" to enable or "off" to disable auto-update.',
				}),
			)
		})

		it("should handle 'false' as invalid", async () => {
			mockContext.args = ["false"]

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: 'Invalid action "false". Use "on" to enable or "off" to disable auto-update.',
				}),
			)
		})
	})

	describe("handler - error handling", () => {
		it("should handle errors gracefully", async () => {
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockRejectedValue(new Error("Failed to save config"))

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: "Auto-update command failed: Failed to save config",
				}),
			)
		})

		it("should handle non-Error objects gracefully", async () => {
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockRejectedValue("String error")

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: "Auto-update command failed: String error",
				}),
			)
		})

		it("should handle null errors gracefully", async () => {
			mockContext.args = ["on"]

			vi.mocked(saveConfig).mockRejectedValue(null)

			await autoupdateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: "Auto-update command failed: null",
				}),
			)
		})
	})
})
