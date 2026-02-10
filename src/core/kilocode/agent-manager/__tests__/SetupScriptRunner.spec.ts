import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { SetupScriptRunner, type SetupScriptEnvironment } from "../SetupScriptRunner"
import { SetupScriptService } from "../SetupScriptService"

// Mock terminal object
const mockTerminal = {
	show: vi.fn(),
	sendText: vi.fn(),
}

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		createTerminal: vi.fn(() => mockTerminal),
	},
	ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),
}))

describe("SetupScriptRunner", () => {
	const testEnv: SetupScriptEnvironment = {
		worktreePath: "/test/project/.kilocode/worktrees/feature-branch",
		repoPath: "/test/project",
	}

	let mockOutputChannel: { appendLine: ReturnType<typeof vi.fn> }
	let mockSetupScriptService: {
		hasScript: ReturnType<typeof vi.fn>
		getScriptPath: ReturnType<typeof vi.fn>
	}
	let runner: SetupScriptRunner

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
		}
		mockSetupScriptService = {
			hasScript: vi.fn(),
			getScriptPath: vi.fn().mockReturnValue("/test/project/.kilocode/setup-script"),
		}
		runner = new SetupScriptRunner(
			mockOutputChannel as unknown as vscode.OutputChannel,
			mockSetupScriptService as unknown as SetupScriptService,
		)
		vi.clearAllMocks()
		// Reset mock terminal functions after clearAllMocks
		mockTerminal.show = vi.fn()
		mockTerminal.sendText = vi.fn()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("runIfConfigured", () => {
		it("returns false and skips when no script is configured", async () => {
			mockSetupScriptService.hasScript.mockReturnValue(false)

			const result = await runner.runIfConfigured(testEnv)

			expect(result).toBe(false)
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("No setup script configured"),
			)
		})

		it("returns true and executes script when configured", async () => {
			const vscode = await import("vscode")
			mockSetupScriptService.hasScript.mockReturnValue(true)

			const result = await runner.runIfConfigured(testEnv)

			expect(result).toBe(true)
			expect(vscode.window.createTerminal).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Worktree Setup",
					cwd: testEnv.worktreePath,
					env: {
						WORKTREE_PATH: testEnv.worktreePath,
						REPO_PATH: testEnv.repoPath,
					},
				}),
			)
			expect(mockTerminal.show).toHaveBeenCalledWith(true)
			expect(mockTerminal.sendText).toHaveBeenCalled()
		})

		it("logs script path when running", async () => {
			mockSetupScriptService.hasScript.mockReturnValue(true)

			await runner.runIfConfigured(testEnv)

			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("Running setup script"))
		})

		it("returns true even when execution fails (non-blocking)", async () => {
			const vscode = await import("vscode")
			mockSetupScriptService.hasScript.mockReturnValue(true)
			vi.mocked(vscode.window.createTerminal).mockImplementation(() => {
				throw new Error("Terminal creation failed")
			})

			const result = await runner.runIfConfigured(testEnv)

			expect(result).toBe(true) // Non-blocking - still returns true
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Setup script execution failed"),
			)
		})
	})

	describe("buildCommand (via terminal sendText)", () => {
		it("builds Unix command with sh", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "linux" })

			mockSetupScriptService.hasScript.mockReturnValue(true)

			await runner.runIfConfigured(testEnv)

			expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining("sh "))

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("builds Windows command with set statements", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32" })

			mockSetupScriptService.hasScript.mockReturnValue(true)

			await runner.runIfConfigured(testEnv)

			// Windows uses set commands to set environment variables
			expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining("set "))

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})
	})
})
