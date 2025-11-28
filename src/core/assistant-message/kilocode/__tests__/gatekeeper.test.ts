import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { evaluateGatekeeperApproval } from "../gatekeeper"
import type { Task } from "../../../task/Task"
import type { ProviderSettings } from "@roo-code/types"
import { execSync } from "child_process"
import { existsSync } from "fs"

// Mock dependencies
vi.mock("child_process")
vi.mock("fs", () => ({
	existsSync: vi.fn(),
}))
vi.mock("../../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-haiku-20240307",
			info: {
				inputPrice: 0.003,
				outputPrice: 0.015,
				cacheWritesPrice: 0.00375,
				cacheReadsPrice: 0.0003,
			},
		}),
		initialize: vi.fn().mockResolvedValue(undefined),
	}),
}))

vi.mock("../../../../shared/cost", () => ({
	calculateApiCostAnthropic: vi.fn().mockReturnValue({
		totalInputTokens: 100,
		totalOutputTokens: 10,
		totalCost: 0.0001,
	}),
	calculateApiCostOpenAI: vi.fn().mockReturnValue({
		totalInputTokens: 100,
		totalOutputTokens: 10,
		totalCost: 0.0001,
	}),
}))

vi.mock("../../../../utils/single-completion-handler", () => ({
	streamResponseFromHandler: vi.fn(),
}))

describe("gatekeeper", () => {
	let mockTask: Partial<Task>
	let mockProviderRef: any
	let mockState: any
	let originalCwd: string

	beforeEach(() => {
		vi.clearAllMocks()
		originalCwd = process.cwd()

		// Mock existsSync to return true by default
		vi.mocked(existsSync).mockReturnValue(true)

		// Mock execSync to throw by default (not a git repo)
		// Individual tests can override this
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("Not a git repository")
		})

		// Setup mock state
		mockState = {
			yoloGatekeeperApiConfigId: "gatekeeper-config-id",
			listApiConfigMeta: [
				{
					id: "gatekeeper-config-id",
					name: "Gatekeeper Config",
				},
			],
		}

		// Setup mock provider ref
		mockProviderRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue(mockState),
				providerSettingsManager: {
					getProfile: vi.fn().mockResolvedValue({
						apiProvider: "anthropic",
						apiModelId: "claude-3-haiku-20240307",
					} as ProviderSettings),
				},
			}),
		}

		// Setup mock task
		mockTask = {
			providerRef: mockProviderRef,
			say: vi.fn().mockResolvedValue(undefined),
			cwd: "/test/workspace",
		}
	})

	afterEach(() => {
		// Restore original cwd
		process.chdir(originalCwd)
	})

	describe("evaluateGatekeeperApproval", () => {
		it("should return true when no gatekeeper is configured", async () => {
			mockState.yoloGatekeeperApiConfigId = undefined

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should return true when listApiConfigMeta is not available", async () => {
			mockState.listApiConfigMeta = undefined

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should return true when listApiConfigMeta is not an array", async () => {
			mockState.listApiConfigMeta = "not-an-array"

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should return true when gatekeeper config is not found", async () => {
			mockState.listApiConfigMeta = [
				{
					id: "different-config-id",
					name: "Different Config",
				},
			]

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should return true when profile cannot be loaded", async () => {
			mockProviderRef.deref().providerSettingsManager.getProfile.mockResolvedValue(null)

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should return true when profile has no apiProvider", async () => {
			mockProviderRef.deref().providerSettingsManager.getProfile.mockResolvedValue({
				apiProvider: undefined,
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should approve when gatekeeper responds with 'yes'", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				},
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(result).toBe(true)
			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("✅ approved"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should approve when gatekeeper responds with 'approve'", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "approve",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should approve when gatekeeper responds with 'allow'", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "allow",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should deny when gatekeeper responds with 'no'", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "no",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "execute_command", {
				command: "rm -rf /",
			})

			expect(result).toBe(false)
			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("❌ denied"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should handle responses with mixed case", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "YES, this is approved",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", { path: "test.ts" })

			expect(result).toBe(true)
		})

		it("should display cost when usage information is available", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
					cacheWriteTokens: 5,
					cacheReadTokens: 20,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("$0.0001"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should display '<$0.0001' for very small costs", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			const { calculateApiCostAnthropic } = await import("../../../../shared/cost")
			vi.mocked(calculateApiCostAnthropic).mockReturnValue({
				totalInputTokens: 10,
				totalOutputTokens: 1,
				totalCost: 0.00005,
			})
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 10,
					outputTokens: 1,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("<$0.0001"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should use totalCost from usage if provided", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
					totalCost: 0.0025,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("$0.0025"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should remove trailing zeroes from cost display", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			const { calculateApiCostAnthropic } = await import("../../../../shared/cost")
			vi.mocked(calculateApiCostAnthropic).mockReturnValue({
				totalInputTokens: 100,
				totalOutputTokens: 10,
				totalCost: 0.0012,
			})
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("$0.0012"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should remove all trailing zeroes including decimal point", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			const { calculateApiCostAnthropic } = await import("../../../../shared/cost")
			vi.mocked(calculateApiCostAnthropic).mockReturnValue({
				totalInputTokens: 100,
				totalOutputTokens: 10,
				totalCost: 0.001,
			})
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("$0.001"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should handle whole dollar amounts without decimal", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "yes",
				usage: {
					type: "usage",
					inputTokens: 100,
					outputTokens: 10,
					totalCost: 1.0,
				},
			})

			await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(mockTask.say).toHaveBeenCalledWith(
				"text",
				expect.stringContaining("$1"),
				undefined,
				false,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
		})

		it("should return true on error to avoid blocking workflow", async () => {
			const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
			vi.mocked(streamResponseFromHandler).mockRejectedValue(new Error("API error"))

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			const result = await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
				path: "test.ts",
				content: "test",
			})

			expect(result).toBe(true)
			expect(consoleSpy).toHaveBeenCalledWith(
				"[Gatekeeper] Error evaluating approval, defaulting to approve:",
				expect.any(Error),
			)

			consoleSpy.mockRestore()
		})

		describe("buildGatekeeperPrompt", () => {
			it("should build prompt for write_to_file tool", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
					path: "test.ts",
					content: "const x = 1;",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining("Tool: write_to_file"),
					expect.stringContaining("WORKSPACE CONTEXT"),
				)
			})

			it("should build prompt for execute_command tool", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "execute_command", {
					command: "npm test",
					cwd: "/test/dir",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining("Command: npm test"),
					expect.any(String),
				)
			})

			it("should pre-approve read_file tool", async () => {
				const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", {
					path: "test.ts",
				})

				expect(result).toBe(true)
				// read_file is pre-approved, so streamResponseFromHandler should not be called
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				expect(streamResponseFromHandler).not.toHaveBeenCalled()
			})

			it("should pre-approve read_file tool with multiple paths", async () => {
				const result = await evaluateGatekeeperApproval(mockTask as Task, "read_file", {
					args: {
						file: [{ path: "test1.ts" }, { path: "test2.ts" }],
					},
				})

				expect(result).toBe(true)
				// read_file is pre-approved, so streamResponseFromHandler should not be called
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				expect(streamResponseFromHandler).not.toHaveBeenCalled()
			})

			it("should build prompt for browser_action tool", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "browser_action", {
					action: "launch",
					url: "https://example.com",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining("Action: launch"),
					expect.any(String),
				)
			})

			it("should build prompt for use_mcp_tool", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "use_mcp_tool", {
					server_name: "github",
					tool_name: "search_repos",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining("Server: github"),
					expect.any(String),
				)
			})

			it("should pre-approve update_todo_list", async () => {
				const result = await evaluateGatekeeperApproval(mockTask as Task, "update_todo_list", {})

				expect(result).toBe(true)
				// update_todo_list is pre-approved, so streamResponseFromHandler should not be called
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				expect(streamResponseFromHandler).not.toHaveBeenCalled()
			})

			it("should truncate long content previews", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				const longContent = "x".repeat(300)
				await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
					path: "test.ts",
					content: longContent,
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining("..."),
					expect.any(String),
				)
			})

			it("should include git repository status in prompt", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(execSync).mockReturnValue(Buffer.from("/test/workspace"))
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
					path: "test.ts",
					content: "test",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.any(String),
					expect.stringContaining("Git repository: YES"),
				)
			})

			it("should handle non-git repository", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(execSync).mockImplementation(() => {
					throw new Error("Not a git repository")
				})
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
					path: "test.ts",
					content: "test",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.any(String),
					expect.stringContaining("Git repository: NO"),
				)
			})

			it("should include workspace directory in prompt", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "write_to_file", {
					path: "test.ts",
					content: "test",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.any(String),
					expect.stringContaining("Workspace directory:"),
				)
			})

			it("should include git tracking status for rm commands", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(execSync)
					.mockReturnValueOnce(Buffer.from("/test/workspace")) // isGitRepository check
					.mockReturnValueOnce(Buffer.from("test.ts")) // isFileTrackedByGit check
				vi.mocked(existsSync).mockReturnValue(true) // File exists check
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "execute_command", {
					command: "rm test.ts",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining('Target file "test.ts" git tracked: YES (recoverable)'),
					expect.any(String),
				)
			})

			it("should handle rm commands with flags", async () => {
				const { streamResponseFromHandler } = await import("../../../../utils/single-completion-handler")
				vi.mocked(execSync)
					.mockReturnValueOnce(Buffer.from("/test/workspace")) // isGitRepository check
					.mockReturnValueOnce(Buffer.from("test.ts")) // isFileTrackedByGit check
				vi.mocked(existsSync).mockReturnValue(true) // File exists check
				vi.mocked(streamResponseFromHandler).mockResolvedValue({
					text: "yes",
					usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
				})

				await evaluateGatekeeperApproval(mockTask as Task, "execute_command", {
					command: "rm -f test.ts",
				})

				expect(streamResponseFromHandler).toHaveBeenCalledWith(
					expect.any(Object),
					expect.stringContaining('Target file "test.ts" git tracked: YES (recoverable)'),
					expect.any(String),
				)
			})
		})
	})
})
