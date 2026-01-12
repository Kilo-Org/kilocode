import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"
import os from "node:os"
import path from "node:path"
import * as vscode from "vscode"
import { SessionTerminalManager } from "../SessionTerminalManager"
import { AgentRegistry } from "../AgentRegistry"

const MOCK_WORKSPACE_PATH = "/tmp/workspace"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createTerminal: vi.fn(),
		showWarningMessage: vi.fn(),
		onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/tmp/workspace" } }],
	},
	ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),
}))

describe("SessionTerminalManager", () => {
	let registry: AgentRegistry
	let terminalManager: SessionTerminalManager
	let mockTerminal: {
		show: Mock
		dispose: Mock
		exitStatus: undefined | { code: number }
	}
	let onDidCloseTerminalCallback: ((terminal: unknown) => void) | undefined
	let mockOutputChannel: { appendLine: Mock }

	beforeEach(() => {
		vi.clearAllMocks()

		registry = new AgentRegistry()

		// Capture the onDidCloseTerminal callback
		;(vscode.window.onDidCloseTerminal as Mock).mockImplementation((callback) => {
			onDidCloseTerminalCallback = callback
			return { dispose: vi.fn() }
		})

		// Create mock terminal
		mockTerminal = {
			show: vi.fn(),
			dispose: vi.fn(),
			exitStatus: undefined,
		}
		;(vscode.window.createTerminal as Mock).mockReturnValue(mockTerminal)

		mockOutputChannel = { appendLine: vi.fn() }
		terminalManager = new SessionTerminalManager(registry, mockOutputChannel as unknown as vscode.OutputChannel)
	})

	describe("showTerminal", () => {
		it("shows warning when session does not exist", () => {
			terminalManager.showTerminal("non-existent")

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("Session not found")
			expect(vscode.window.createTerminal).not.toHaveBeenCalled()
		})

		it("creates terminal with workspace path for local session (no worktree)", () => {
			// Create a session without parallelMode (local session)
			registry.createSession("session-1", "test prompt")

			terminalManager.showTerminal("session-1")

			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				cwd: MOCK_WORKSPACE_PATH,
				name: "Agent: test prompt (local)",
				iconPath: expect.objectContaining({ id: "terminal" }),
			})
			expect(mockTerminal.show).toHaveBeenCalled()
		})

		it("shows warning when parallelMode session does not have worktreePath", () => {
			// Create a session with parallelMode but no worktreePath yet
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })

			terminalManager.showTerminal("session-1")

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("Worktree path not available yet")
			expect(vscode.window.createTerminal).not.toHaveBeenCalled()
		})

		it("derives worktree path from branch when missing", () => {
			const branch = "feature-branch"
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", { branch })

			terminalManager.showTerminal("session-1")

			const expectedPath = path.join(os.tmpdir(), `kilocode-worktree-${branch}`)
			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				cwd: expectedPath,
				name: `Agent: ${branch}`,
				iconPath: expect.objectContaining({ id: "terminal" }),
			})
			expect(mockTerminal.show).toHaveBeenCalled()
		})

		it("creates terminal with worktree path when session has worktree path", () => {
			// Create a session with parallelMode and worktreePath
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
				branch: "feature-branch",
			})

			terminalManager.showTerminal("session-1")

			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				cwd: "/tmp/worktree-path",
				name: "Agent: feature-branch",
				iconPath: expect.objectContaining({ id: "terminal" }),
			})
			expect(mockTerminal.show).toHaveBeenCalled()
		})

		it("uses session label when branch name is not available for worktree session", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")

			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				cwd: "/tmp/worktree-path",
				name: "Agent: test prompt",
				iconPath: expect.objectContaining({ id: "terminal" }),
			})
		})

		it("reuses existing terminal instead of creating new one", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
				branch: "feature-branch",
			})

			// First call creates terminal
			terminalManager.showTerminal("session-1")
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)

			// Second call reuses terminal
			terminalManager.showTerminal("session-1")
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)
			expect(mockTerminal.show).toHaveBeenCalledTimes(2)
		})

		it("creates new terminal if previous one was closed", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
				branch: "feature-branch",
			})

			// First call creates terminal
			terminalManager.showTerminal("session-1")
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)

			// Simulate terminal being closed (exitStatus is set)
			mockTerminal.exitStatus = { code: 0 }

			// Create a new mock terminal for the second call
			const newMockTerminal = {
				show: vi.fn(),
				dispose: vi.fn(),
				exitStatus: undefined,
			}
			;(vscode.window.createTerminal as Mock).mockReturnValue(newMockTerminal)

			// Second call should create new terminal
			terminalManager.showTerminal("session-1")
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2)
		})
	})

	describe("closeTerminal", () => {
		it("disposes terminal when it exists", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			terminalManager.closeTerminal("session-1")

			expect(mockTerminal.dispose).toHaveBeenCalled()
		})

		it("does nothing when terminal does not exist", () => {
			// Should not throw
			terminalManager.closeTerminal("non-existent")
		})

		it("removes terminal from tracking after close", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			terminalManager.closeTerminal("session-1")

			expect(terminalManager.hasTerminal("session-1")).toBe(false)
		})
	})

	describe("hasTerminal", () => {
		it("returns false when no terminal exists for session", () => {
			expect(terminalManager.hasTerminal("session-1")).toBe(false)
		})

		it("returns true when terminal exists and is active", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")

			expect(terminalManager.hasTerminal("session-1")).toBe(true)
		})

		it("returns false when terminal was closed", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			mockTerminal.exitStatus = { code: 0 }

			expect(terminalManager.hasTerminal("session-1")).toBe(false)
		})
	})

	describe("showExistingTerminal", () => {
		it("returns false when terminal does not exist", () => {
			expect(terminalManager.showExistingTerminal("session-1")).toBe(false)
			expect(vscode.window.createTerminal).not.toHaveBeenCalled()
		})

		it("shows terminal when it exists and is active", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			const result = terminalManager.showExistingTerminal("session-1")

			expect(result).toBe(true)
			expect(mockTerminal.show).toHaveBeenCalledTimes(2)
		})

		it("clears mapping when terminal has exited", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			mockTerminal.exitStatus = { code: 0 }

			const result = terminalManager.showExistingTerminal("session-1")
			expect(result).toBe(false)
			expect(terminalManager.hasTerminal("session-1")).toBe(false)
		})
	})

	describe("onDidCloseTerminal cleanup", () => {
		it("removes terminal from tracking when user closes it", () => {
			registry.createSession("session-1", "test prompt", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", {
				worktreePath: "/tmp/worktree-path",
			})

			terminalManager.showTerminal("session-1")
			expect(terminalManager.hasTerminal("session-1")).toBe(true)

			// Simulate user closing the terminal
			onDidCloseTerminalCallback?.(mockTerminal)

			// Terminal should be removed from tracking
			// Note: hasTerminal checks exitStatus, but the map entry should be removed
			// We need to verify by trying to show terminal again
			;(vscode.window.createTerminal as Mock).mockClear()
			const newMockTerminal = {
				show: vi.fn(),
				dispose: vi.fn(),
				exitStatus: undefined,
			}
			;(vscode.window.createTerminal as Mock).mockReturnValue(newMockTerminal)

			terminalManager.showTerminal("session-1")
			expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1)
		})

		it("does not affect other sessions when one terminal is closed", () => {
			// Create two sessions with terminals
			registry.createSession("session-1", "test prompt 1", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-1", { worktreePath: "/tmp/worktree-1" })

			registry.createSession("session-2", "test prompt 2", undefined, { parallelMode: true })
			registry.updateParallelModeInfo("session-2", { worktreePath: "/tmp/worktree-2" })

			const mockTerminal1 = { show: vi.fn(), dispose: vi.fn(), exitStatus: undefined }
			const mockTerminal2 = { show: vi.fn(), dispose: vi.fn(), exitStatus: undefined }

			;(vscode.window.createTerminal as Mock)
				.mockReturnValueOnce(mockTerminal1)
				.mockReturnValueOnce(mockTerminal2)

			terminalManager.showTerminal("session-1")
			terminalManager.showTerminal("session-2")

			// Close only the first terminal
			onDidCloseTerminalCallback?.(mockTerminal1)

			// Second terminal should still be tracked
			expect(terminalManager.hasTerminal("session-2")).toBe(true)
		})
	})

	describe("dispose", () => {
		it("disposes all event listeners", () => {
			const disposeMock = vi.fn()
			;(vscode.window.onDidCloseTerminal as Mock).mockReturnValue({ dispose: disposeMock })

			const manager = new SessionTerminalManager(registry, {
				appendLine: vi.fn(),
			} as unknown as vscode.OutputChannel)
			manager.dispose()

			expect(disposeMock).toHaveBeenCalled()
		})
	})
})
