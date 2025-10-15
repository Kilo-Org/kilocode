// npx vitest run src/integrations/terminal/__tests__/TerminalRegistry.spec.ts

import * as vscode from "vscode"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

const PAGER = process.platform === "win32" ? "" : "cat"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/test/workspace"),
	arePathsEqual: vi.fn((path1, path2) => path1 === path2),
}))

describe("TerminalRegistry", () => {
	let mockCreateTerminal: any

	beforeEach(() => {
		mockCreateTerminal = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
			(...args: any[]) =>
				({
					exitStatus: undefined,
					name: "Kilo Code",
					processId: Promise.resolve(123),
					creationOptions: {},
					state: {
						isInteractedWith: true,
						shell: { id: "test-shell", executable: "/bin/bash", args: [] },
					},
					dispose: vi.fn(),
					hide: vi.fn(),
					show: vi.fn(),
					sendText: vi.fn(),
					shellIntegration: {
						executeCommand: vi.fn(),
					},
				}) as any,
		)
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: "Kilo Code",
				iconPath: expect.any(Object),
				env: {
					PAGER,
					VTE_VERSION: "0",
					WORKSPACE_ROOT: "/test/workspace", // kilocode_change
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Kilo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Kilo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Kilo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	describe("initialize and cleanup", () => {
		beforeEach(() => {
			// Reset initialization state before each test
			TerminalRegistry["isInitialized"] = false
			TerminalRegistry["disposables"] = []
		})

		it("should allow re-initialization after cleanup", () => {
			// First initialization
			expect(() => TerminalRegistry.initialize()).not.toThrow()

			// Should throw on second call without cleanup
			expect(() => TerminalRegistry.initialize()).toThrow(
				"TerminalRegistry.initialize() should only be called once",
			)

			// Cleanup
			TerminalRegistry.cleanup()

			// Should allow re-initialization after cleanup
			expect(() => TerminalRegistry.initialize()).not.toThrow()
		})

		it("should dispose all event handlers during cleanup", () => {
			TerminalRegistry.initialize()

			const disposables = TerminalRegistry["disposables"]
			const disposeSpy = vi.fn()

			// Add spy to existing disposables
			disposables.forEach((d) => {
				d.dispose = disposeSpy
			})

			TerminalRegistry.cleanup()

			// All disposables should have been disposed
			expect(disposeSpy).toHaveBeenCalledTimes(disposables.length)
			expect(TerminalRegistry["disposables"]).toHaveLength(0)
			expect(TerminalRegistry["isInitialized"]).toBe(false)
		})
	})

	describe("getOrCreateTerminal race condition prevention", () => {
		beforeEach(() => {
			TerminalRegistry["terminals"] = []
			TerminalRegistry["nextTerminalId"] = 1
		})

		it("should mark terminal as busy immediately upon return", async () => {
			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")

			expect(terminal.busy).toBe(true)
		})

		it("should not return the same terminal for concurrent requests", async () => {
			const [terminal1, terminal2] = await Promise.all([
				TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode"),
				TerminalRegistry.getOrCreateTerminal("/test/path", "task-2", "vscode"),
			])

			expect(terminal1.id).not.toBe(terminal2.id)
			expect(terminal1.busy).toBe(true)
			expect(terminal2.busy).toBe(true)
		})

		it("should create new terminal if existing ones are busy", async () => {
			const terminal1 = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")
			expect(terminal1.busy).toBe(true)

			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-2", "vscode")

			expect(terminal1.id).not.toBe(terminal2.id)
			expect(terminal2.busy).toBe(true)
		})

		it("should reuse terminal when marked not busy", async () => {
			const terminal1 = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")
			terminal1.busy = false
			terminal1.taskId = undefined

			const terminal2 = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-2", "vscode")

			expect(terminal1.id).toBe(terminal2.id)
			expect(terminal2.busy).toBe(true)
		})
	})
})
