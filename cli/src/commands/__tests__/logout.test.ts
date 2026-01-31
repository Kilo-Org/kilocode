/**
 * Tests for the /logout command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { logoutCommand } from "../logout.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { CLIConfig } from "../../config/types.js"

// Mock the saveConfig function
vi.mock("../../config/index.js", () => ({
	saveConfig: vi.fn().mockResolvedValue(undefined),
}))

describe("logoutCommand", () => {
	let mockContext: CommandContext
	let addMessageSpy: ReturnType<typeof vi.fn>
	let mockConfig: CLIConfig

	beforeEach(() => {
		vi.clearAllMocks()
		addMessageSpy = vi.fn()

		// Create a mock config with providers
		mockConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "kilocode",
			providers: [
				{
					id: "kilocode",
					provider: "kilocode",
					kilocodeToken: "test-token-123",
					kilocodeModel: "x-ai/grok-code-fast-1",
				},
				{
					id: "anthropic",
					provider: "anthropic",
					anthropicApiKey: "anthropic-key-456",
				},
			],
			autoApproval: {
				enabled: true,
				read: { enabled: true, outside: false },
				write: { enabled: true, outside: true, protected: false },
				browser: { enabled: false },
				retry: { enabled: false, delay: 10 },
				mcp: { enabled: true },
				mode: { enabled: true },
				subtasks: { enabled: true },
				execute: {
					enabled: true,
					allowed: ["ls", "cat", "echo", "pwd"],
					denied: ["rm -rf", "sudo rm", "mkfs", "dd if="],
				},
				question: { enabled: false, timeout: 60 },
				todo: { enabled: true },
			},
			theme: "dark",
			customThemes: {},
		}

		mockContext = createMockContext({
			input: "/logout",
			addMessage: addMessageSpy,
			config: mockConfig,
		})
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(logoutCommand.name).toBe("logout")
		})

		it("should have no aliases", () => {
			expect(logoutCommand.aliases).toEqual([])
		})

		it("should have correct category", () => {
			expect(logoutCommand.category).toBe("settings")
		})

		it("should have correct priority", () => {
			expect(logoutCommand.priority).toBe(8)
		})

		it("should have description", () => {
			expect(logoutCommand.description).toBeTruthy()
			expect(logoutCommand.description).toContain("authentication")
		})

		it("should have usage examples", () => {
			expect(logoutCommand.examples).toHaveLength(1)
			expect(logoutCommand.examples).toContain("/logout")
		})
	})

	describe("handler", () => {
		it("should show message when no providers are configured", async () => {
			mockContext = createMockContext({
				input: "/logout",
				addMessage: addMessageSpy,
				config: {
					...mockConfig,
					providers: [],
				},
			})

			await logoutCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "No providers configured. Nothing to logout from.",
				}),
			)
		})

		it("should empty the providers array", async () => {
			const { saveConfig } = await import("../../config/index.js")
			const saveConfigMock = vi.mocked(saveConfig)

			await logoutCommand.handler(mockContext)

			expect(saveConfigMock).toHaveBeenCalledTimes(1)
			const savedConfig = saveConfigMock.mock.calls[0][0] as CLIConfig

			expect(savedConfig.providers).toEqual([])
		})

		it("should set provider to empty string", async () => {
			const { saveConfig } = await import("../../config/index.js")
			const saveConfigMock = vi.mocked(saveConfig)

			await logoutCommand.handler(mockContext)

			expect(saveConfigMock).toHaveBeenCalledTimes(1)
			const savedConfig = saveConfigMock.mock.calls[0][0] as CLIConfig

			expect(savedConfig.provider).toBe("")
		})

		it("should show success message on successful logout", async () => {
			const { saveConfig } = await import("../../config/index.js")
			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await logoutCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "✓ Successfully logged out. All authentication credentials have been cleared.",
				}),
			)
		})

		it("should show error message when saveConfig fails", async () => {
			const { saveConfig } = await import("../../config/index.js")
			vi.mocked(saveConfig).mockRejectedValue(new Error("Failed to save config"))

			await logoutCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: "Failed to logout: Failed to save config",
				}),
			)
		})

		it("should call exit method after successful logout", async () => {
			const { saveConfig } = await import("../../config/index.js")
			vi.mocked(saveConfig).mockResolvedValue(undefined)

			// Create a spy for the exit method
			const exitSpy = vi.fn()
			mockContext.exit = exitSpy

			await logoutCommand.handler(mockContext)

			expect(exitSpy).toHaveBeenCalledTimes(1)
		})

		it("should execute without errors", async () => {
			const { saveConfig } = await import("../../config/index.js")
			vi.mocked(saveConfig).mockResolvedValue(undefined)

			await expect(logoutCommand.handler(mockContext)).resolves.not.toThrow()
		})
	})
})
