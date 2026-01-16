/**
 * Tests for the /update command
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { updateCommand } from "../update.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the update service functions
vi.mock("../../services/update.js", () => ({
	checkForUpdates: vi.fn(),
	performUpdate: vi.fn(),
	restartCLI: vi.fn(),
}))

// Mock the generateMessage function
vi.mock("../../ui/utils/messages.js", () => ({
	generateMessage: vi.fn(() => ({
		id: "test-message-id",
		role: "assistant",
		timestamp: Date.now(),
	})),
}))

// Mock readline for user confirmation
vi.mock("readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn((_prompt: string, callback: (answer: string) => void) => {
			// Default to "y" for tests
			callback("y")
		}),
		close: vi.fn(),
	})) as any,
}))

import { checkForUpdates, performUpdate, restartCLI } from "../../services/update.js"

describe("updateCommand", () => {
	let mockContext: CommandContext
	let addMessageSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		addMessageSpy = vi.fn()

		mockContext = createMockContext({
			input: "/update",
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
			expect(updateCommand.name).toBe("update")
		})

		it("should have correct aliases", () => {
			expect(updateCommand.aliases).toEqual([])
		})

		it("should have correct category", () => {
			expect(updateCommand.category).toBe("system")
		})

		it("should have description", () => {
			expect(updateCommand.description).toBeTruthy()
			expect(updateCommand.description).toContain("update")
		})

		it("should have usage", () => {
			expect(updateCommand.usage).toBe("/update")
		})

		it("should have examples", () => {
			expect(updateCommand.examples).toHaveLength(1)
			expect(updateCommand.examples).toContain("/update")
		})
	})

	describe("handler - no update available", () => {
		it("should check for updates when called", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				updateAvailable: false,
				message: "Already up to date (v1.0.0)",
			})

			await updateCommand.handler(mockContext)

			expect(checkForUpdates).toHaveBeenCalledTimes(1)
		})

		it("should display 'Already up to date' message when no update is available", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				updateAvailable: false,
				message: "Already up to date (v1.0.0)",
			})

			await updateCommand.handler(mockContext)

			// First message: "Checking for updates..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					type: "system",
					content: "Checking for updates...",
				}),
			)

			// Second message: "Already up to date"
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "system",
					content: "Already up to date (v1.0.0)",
				}),
			)
		})

		it("should not call performUpdate or restartCLI when no update is available", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				updateAvailable: false,
				message: "Already up to date (v1.0.0)",
			})

			await updateCommand.handler(mockContext)

			expect(performUpdate).not.toHaveBeenCalled()
			expect(restartCLI).not.toHaveBeenCalled()
		})
	})

	describe("handler - update available", () => {
		it("should display version information when update is available", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			// First message: "Checking for updates..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					type: "system",
					content: "Checking for updates...",
				}),
			)

			// Second message: "Update available: 1.0.0 → 1.1.0"
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "system",
					content: "Update available: 1.0.0 → 1.1.0",
				}),
			)

			// Third message: confirmation prompt
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				3,
				expect.objectContaining({
					type: "system",
					content: "Would you like to update now? This will install the latest version and restart the CLI.",
				}),
			)
		})

		it("should perform update when update is available", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			expect(performUpdate).toHaveBeenCalledTimes(1)
		})

		it("should display 'Installing update...' message before performing update", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			// Fourth message: "Installing update..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				4,
				expect.objectContaining({
					type: "system",
					content: "Installing update...",
				}),
			)
		})

		it("should display success message when update completes successfully", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			// Fifth message: success message
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				5,
				expect.objectContaining({
					type: "system",
					content: "Update completed successfully. Please restart the CLI to use the new version.",
				}),
			)
		})

		it("should update lastUpdateCheck in config when update completes successfully", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			expect(mockContext.config.lastUpdateCheck).toBeTruthy()
			expect(typeof mockContext.config.lastUpdateCheck).toBe("string")
		})

		it("should restart CLI when update completes successfully", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			expect(restartCLI).toHaveBeenCalledTimes(1)
		})

		it("should display 'Restarting CLI...' message before restarting", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: true,
				message: "Update completed successfully. Please restart the CLI to use the new version.",
			})

			await updateCommand.handler(mockContext)

			// Sixth message: "Restarting CLI..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				6,
				expect.objectContaining({
					type: "system",
					content: "Restarting CLI...",
				}),
			)
		})
	})

	describe("handler - update failure", () => {
		it("should display error message when update fails", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: false,
				message: "Update failed with exit code 1. Please check the logs for details.",
			})

			await updateCommand.handler(mockContext)

			// Fifth message: error message
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				5,
				expect.objectContaining({
					type: "error",
					content: "Update failed with exit code 1. Please check the logs for details.",
				}),
			)
		})

		it("should not restart CLI when update fails", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				updateAvailable: true,
				message: "Update available: 1.0.0 → 1.1.0",
			})

			vi.mocked(performUpdate).mockResolvedValue({
				success: false,
				message: "Update failed with exit code 1. Please check the logs for details.",
			})

			await updateCommand.handler(mockContext)

			expect(restartCLI).not.toHaveBeenCalled()
		})
	})

	describe("handler - error handling", () => {
		it("should handle errors gracefully", async () => {
			vi.mocked(checkForUpdates).mockRejectedValue(new Error("Network error"))

			await updateCommand.handler(mockContext)

			// First message: "Checking for updates..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					type: "system",
					content: "Checking for updates...",
				}),
			)

			// Second message: error message
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "error",
					content: "Update command failed: Network error",
				}),
			)
		})

		it("should handle non-Error objects gracefully", async () => {
			vi.mocked(checkForUpdates).mockRejectedValue("String error")

			await updateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "error",
					content: "Update command failed: String error",
				}),
			)
		})

		it("should handle null errors gracefully", async () => {
			vi.mocked(checkForUpdates).mockRejectedValue(null)

			await updateCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "error",
					content: "Update command failed: null",
				}),
			)
		})
	})

	describe("handler - failed to check for updates", () => {
		it("should display error message when checkForUpdates returns null latestVersion", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: null,
				updateAvailable: false,
				message: "Failed to check for updates. Please try again later.",
			})

			await updateCommand.handler(mockContext)

			// First message: "Checking for updates..."
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					type: "system",
					content: "Checking for updates...",
				}),
			)

			// Second message: error message
			expect(addMessageSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					type: "system",
					content: "Failed to check for updates. Please try again later.",
				}),
			)
		})

		it("should not call performUpdate or restartCLI when checkForUpdates fails", async () => {
			vi.mocked(checkForUpdates).mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: null,
				updateAvailable: false,
				message: "Failed to check for updates. Please try again later.",
			})

			await updateCommand.handler(mockContext)

			expect(performUpdate).not.toHaveBeenCalled()
			expect(restartCLI).not.toHaveBeenCalled()
		})
	})
})
