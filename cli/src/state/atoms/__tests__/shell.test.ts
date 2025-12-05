import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { shellModeActiveAtom, toggleShellModeAtom, executeShellCommandAtom, keyboardHandlerAtom } from "../keyboard.js"
import { inputModeAtom } from "../ui.js"
import type { Key } from "../../../types/keyboard.js"
import {
	shellHistoryAtom,
	shellHistoryIndexAtom,
	navigateShellHistoryUpAtom,
	navigateShellHistoryDownAtom,
	addToShellHistoryAtom,
} from "../shell.js"
import { textBufferStringAtom, setTextAtom } from "../textBuffer.js"

// Mock child_process to avoid actual command execution; provide exec and execFile for clipboard code
vi.mock("child_process", () => ({
	exec: vi.fn((command) => {
		const stdout = `Mock output for: ${command}`
		const stderr = ""
		const process = {
			stdout: {
				on: vi.fn((event, handler) => {
					if (event === "data") {
						setTimeout(() => handler(stdout), 10)
					}
				}),
			},
			stderr: {
				on: vi.fn((event, handler) => {
					if (event === "data") {
						setTimeout(() => handler(stderr), 10)
					}
				}),
			},
			on: vi.fn((event, handler) => {
				if (event === "close") {
					setTimeout(() => handler(0), 20)
				}
			}),
		}
		return process
	}),
	execFile: vi.fn((..._args) => {
		throw new Error("execFile mocked in shell tests")
	}),
}))

describe("shell mode - comprehensive tests", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		// Clear shell history before each test
		store.set(shellHistoryAtom, [])
		store.set(shellModeActiveAtom, false)
		store.set(inputModeAtom, "normal" as const)
		store.set(shellHistoryIndexAtom, -1)
	})

	describe("shell mode activation", () => {
		it("should toggle shell mode on and off when input is empty", () => {
			// Initial state
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
			expect(store.get(textBufferStringAtom)).toBe("")

			// Toggle on (input is empty)
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")

			// Toggle off
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
		})

		it("should NOT enter shell mode when input is not empty", () => {
			// Set some text in the buffer
			store.set(setTextAtom, "some text")
			expect(store.get(textBufferStringAtom)).toBe("some text")

			// Try to toggle on
			store.set(toggleShellModeAtom)

			// Should NOT activate shell mode
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")

			// Text should still be there
			expect(store.get(textBufferStringAtom)).toBe("some text")
		})

		it("should exit shell mode even when text is present", () => {
			// Enter shell mode (with empty input)
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Add some text
			store.set(setTextAtom, "some command")

			// Toggle off should work even with text
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
		})

		it("should reset history index when toggling on", () => {
			// Set a non-default history index
			store.set(shellHistoryIndexAtom, 5)

			// Toggle on
			store.set(toggleShellModeAtom)

			// Index should be reset
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
		})

		it("should reset history index when toggling off", () => {
			// Activate shell mode and set history index
			store.set(toggleShellModeAtom)
			store.set(shellHistoryIndexAtom, 3)

			// Toggle off
			store.set(toggleShellModeAtom)

			// Index should be reset
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
		})

		it("should handle multiple rapid toggles when input is empty", () => {
			// Toggle multiple times (with empty input)
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(false)

			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(false)

			// Final state should be consistent
			expect(store.get(inputModeAtom)).toBe("normal")
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
		})
	})

	describe("shell command execution", () => {
		it("should add commands to history", async () => {
			const command = "echo 'test'"
			await store.set(executeShellCommandAtom, command)

			const history = store.get(shellHistoryAtom)
			expect(history).toContain(command)
			expect(history.length).toBe(1)
		})

		it("should not add empty commands to history", async () => {
			const emptyCommand = "   "
			await store.set(executeShellCommandAtom, emptyCommand)

			const history = store.get(shellHistoryAtom)
			expect(history).toHaveLength(0)
		})

		it("should trim whitespace from commands before adding to history", async () => {
			const command = "  echo 'test'  "
			await store.set(executeShellCommandAtom, command)

			const history = store.get(shellHistoryAtom)
			expect(history[0]).toBe("echo 'test'")
		})

		it("should add multiple unique commands to history", async () => {
			await store.set(executeShellCommandAtom, "ls")
			await store.set(executeShellCommandAtom, "pwd")
			await store.set(executeShellCommandAtom, "echo test")

			const history = store.get(shellHistoryAtom)
			expect(history).toEqual(["ls", "pwd", "echo test"])
		})

		it("should reset history navigation index after command execution", async () => {
			// Add a few commands to history
			await store.set(executeShellCommandAtom, "echo 'test1'")
			await store.set(executeShellCommandAtom, "echo 'test2'")

			// Set history index to simulate navigation
			store.set(shellHistoryIndexAtom, 1)
			expect(store.get(shellHistoryIndexAtom)).toBe(1)

			// Execute a new command
			await store.set(executeShellCommandAtom, "echo 'test3'")

			// History index should be reset to -1
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
		})

		it("should allow duplicate commands in history", async () => {
			await store.set(executeShellCommandAtom, "echo test")
			await store.set(executeShellCommandAtom, "ls")
			await store.set(executeShellCommandAtom, "echo test")

			const history = store.get(shellHistoryAtom)
			expect(history).toEqual(["echo test", "ls", "echo test"])
		})
	})

	describe("shell history management", () => {
		it("should limit history to 100 commands", async () => {
			// Add 105 commands
			for (let i = 0; i < 105; i++) {
				await store.set(executeShellCommandAtom, `command${i}`)
			}

			const history = store.get(shellHistoryAtom)
			expect(history).toHaveLength(100)
			// Should keep the most recent 100
			expect(history[0]).toBe("command5")
			expect(history[99]).toBe("command104")
		})

		it("should add command to history with addToShellHistoryAtom", () => {
			store.set(addToShellHistoryAtom, "test command")
			const history = store.get(shellHistoryAtom)
			expect(history).toContain("test command")
		})

		it("should maintain history order (newest last)", async () => {
			await store.set(executeShellCommandAtom, "first")
			await store.set(executeShellCommandAtom, "second")
			await store.set(executeShellCommandAtom, "third")

			const history = store.get(shellHistoryAtom)
			expect(history).toEqual(["first", "second", "third"])
		})
	})

	describe("history navigation - up", () => {
		it("should navigate to most recent command on first up", () => {
			// Add commands to history
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3"])

			// Navigate up
			store.set(navigateShellHistoryUpAtom)

			expect(store.get(shellHistoryIndexAtom)).toBe(2)
			expect(store.get(textBufferStringAtom)).toBe("cmd3")
		})

		it("should navigate to older commands with successive up presses", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3"])

			// First up - most recent
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(2)
			expect(store.get(textBufferStringAtom)).toBe("cmd3")

			// Second up - older
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(1)
			expect(store.get(textBufferStringAtom)).toBe("cmd2")

			// Third up - oldest
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(0)
			expect(store.get(textBufferStringAtom)).toBe("cmd1")
		})

		it("should stop at oldest command", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2"])

			// Navigate to oldest
			store.set(navigateShellHistoryUpAtom)
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(0)

			// Try to go further up
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(0)
			expect(store.get(textBufferStringAtom)).toBe("cmd1")
		})

		it("should do nothing when history is empty", () => {
			store.set(shellHistoryAtom, [])

			store.set(navigateShellHistoryUpAtom)

			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
			expect(store.get(textBufferStringAtom)).toBe("")
		})

		it("should handle single command history", () => {
			store.set(shellHistoryAtom, ["only-cmd"])

			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(0)
			expect(store.get(textBufferStringAtom)).toBe("only-cmd")

			// Try to go up again
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(0)
		})
	})

	describe("history navigation - down", () => {
		it("should do nothing when at default index", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3"])
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)

			store.set(navigateShellHistoryDownAtom)

			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
		})

		it("should navigate to newer commands", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3", "cmd4"])

			// Go to oldest
			store.set(shellHistoryIndexAtom, 0)

			// Navigate down to newer
			store.set(navigateShellHistoryDownAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(1)
			expect(store.get(textBufferStringAtom)).toBe("cmd2")

			store.set(navigateShellHistoryDownAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(2)
			expect(store.get(textBufferStringAtom)).toBe("cmd3")
		})

		it("should clear input when reaching most recent", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2"])

			// Navigate up and then back down
			store.set(navigateShellHistoryUpAtom) // index 1 (cmd2)
			store.set(navigateShellHistoryUpAtom) // index 0 (cmd1)
			store.set(navigateShellHistoryDownAtom) // index 1 (cmd2)
			store.set(navigateShellHistoryDownAtom) // index -1 (clear)

			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
			expect(store.get(textBufferStringAtom)).toBe("")
		})

		it("should handle navigation cycle: up then all the way down", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3"])

			// Go up to recent
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(textBufferStringAtom)).toBe("cmd3")

			// Go all the way down to clear
			store.set(navigateShellHistoryDownAtom)
			expect(store.get(shellHistoryIndexAtom)).toBe(-1)
			expect(store.get(textBufferStringAtom)).toBe("")
		})
	})

	describe("history navigation - combined up/down", () => {
		it("should handle mixed up/down navigation", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2", "cmd3", "cmd4"])

			// Up twice
			store.set(navigateShellHistoryUpAtom) // cmd4
			store.set(navigateShellHistoryUpAtom) // cmd3
			expect(store.get(textBufferStringAtom)).toBe("cmd3")

			// Down once
			store.set(navigateShellHistoryDownAtom) // cmd4
			expect(store.get(textBufferStringAtom)).toBe("cmd4")

			// Up once
			store.set(navigateShellHistoryUpAtom) // cmd3
			expect(store.get(textBufferStringAtom)).toBe("cmd3")

			// Up to oldest
			store.set(navigateShellHistoryUpAtom) // cmd2
			store.set(navigateShellHistoryUpAtom) // cmd1
			expect(store.get(textBufferStringAtom)).toBe("cmd1")
		})
	})

	describe("Shift+1 key detection", () => {
		it("should detect Shift+1 and toggle shell mode when input is empty", async () => {
			const shift1Key: Key = {
				name: "shift-1",
				sequence: "!",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}

			// Ensure input is empty
			expect(store.get(textBufferStringAtom)).toBe("")

			// Press Shift+1
			await store.set(keyboardHandlerAtom, shift1Key)

			// Should activate shell mode
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")
		})

		it("should toggle shell mode off with second Shift+1", async () => {
			const shift1Key: Key = {
				name: "shift-1",
				sequence: "!",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}

			// Activate (with empty input)
			await store.set(keyboardHandlerAtom, shift1Key)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Deactivate
			await store.set(keyboardHandlerAtom, shift1Key)
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
		})

		it("should NOT activate shell mode via Shift+1 when input has text", async () => {
			const shift1Key: Key = {
				name: "shift-1",
				sequence: "!",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}

			// Add text to input
			store.set(setTextAtom, "some command")
			expect(store.get(textBufferStringAtom)).toBe("some command")

			// Try to activate with Shift+1
			await store.set(keyboardHandlerAtom, shift1Key)

			// Should NOT activate shell mode
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
		})

		it("should insert '!' when Shift+1 is pressed with text in input", async () => {
			const shift1Key: Key = {
				name: "shift-1",
				sequence: "!",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}

			// Add text to input
			store.set(setTextAtom, "some command")
			expect(store.get(textBufferStringAtom)).toBe("some command")

			// Press Shift+1
			await store.set(keyboardHandlerAtom, shift1Key)

			// Should NOT activate shell mode
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")

			// Should insert "!" into the text
			expect(store.get(textBufferStringAtom)).toBe("some command!")
		})
	})

	describe("@ tag (file mention) handling in shell mode", () => {
		it("should not trigger file mention autocomplete when typing @ in shell mode", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type text with @ symbol
			store.set(setTextAtom, "git commit -m 'fix @username'")

			// Verify shell mode is still active
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")

			// The @ should be treated as regular text, not triggering file mentions
			expect(store.get(textBufferStringAtom)).toBe("git commit -m 'fix @username'")
		})

		it("should allow @ symbols in email addresses in shell mode", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with email
			const emailCommand = "git config user.email user@example.com"
			store.set(setTextAtom, emailCommand)

			// Verify the @ is preserved as normal text
			expect(store.get(textBufferStringAtom)).toBe(emailCommand)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow multiple @ symbols in shell commands", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with multiple @ symbols
			const command = "echo 'user@host, admin@host, test@domain'"
			store.set(setTextAtom, command)

			// Verify all @ symbols are preserved
			expect(store.get(textBufferStringAtom)).toBe(command)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow @ in shell command arguments", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with @ in various positions
			const command = "ssh user@remote.host -p 22"
			store.set(setTextAtom, command)

			// Verify @ is treated as normal text
			expect(store.get(textBufferStringAtom)).toBe(command)
		})

		it("should handle @ at the start of a shell command", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command starting with @
			store.set(setTextAtom, "@echo test")

			// Verify @ is preserved
			expect(store.get(textBufferStringAtom)).toBe("@echo test")
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})
	})

	describe("/ command suggestions in shell mode", () => {
		it("should not trigger command suggestions when typing / in shell mode", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type text with / for paths
			store.set(setTextAtom, "cd /home/user/projects")

			// Verify shell mode is still active
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")

			// The / should be treated as regular text (path separator), not triggering commands
			expect(store.get(textBufferStringAtom)).toBe("cd /home/user/projects")
		})

		it("should allow absolute paths with / in shell mode", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with absolute path
			const pathCommand = "ls -la /var/log/"
			store.set(setTextAtom, pathCommand)

			// Verify the / is preserved as normal text
			expect(store.get(textBufferStringAtom)).toBe(pathCommand)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow multiple slashes in file paths", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with multiple slashes
			const command = "cat /etc/nginx/nginx.conf"
			store.set(setTextAtom, command)

			// Verify all / symbols are preserved
			expect(store.get(textBufferStringAtom)).toBe(command)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow / at the start of a shell command (absolute paths)", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command starting with / (absolute path)
			store.set(setTextAtom, "/usr/bin/python3 script.py")

			// Verify / is preserved
			expect(store.get(textBufferStringAtom)).toBe("/usr/bin/python3 script.py")
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow URLs with / and @ in shell mode", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type command with URL containing both @ and /
			const curlCommand = "curl https://user@example.com/api/endpoint"
			store.set(setTextAtom, curlCommand)

			// Verify both @ and / are preserved
			expect(store.get(textBufferStringAtom)).toBe(curlCommand)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})

		it("should allow git commands with / in branch names", () => {
			// Enter shell mode
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)

			// Type git command with / in branch name
			const gitCommand = "git checkout feature/add-new-feature"
			store.set(setTextAtom, gitCommand)

			// Verify / is preserved
			expect(store.get(textBufferStringAtom)).toBe(gitCommand)
			expect(store.get(shellModeActiveAtom)).toBe(true)
		})
	})

	describe("edge cases", () => {
		it("should handle empty string command gracefully", async () => {
			await store.set(executeShellCommandAtom, "")
			const history = store.get(shellHistoryAtom)
			expect(history).toHaveLength(0)
		})

		it("should handle only whitespace command", async () => {
			await store.set(executeShellCommandAtom, "   \t\n  ")
			const history = store.get(shellHistoryAtom)
			expect(history).toHaveLength(0)
		})

		it("should preserve history when toggling shell mode", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2"])

			// Toggle on and off
			store.set(toggleShellModeAtom)
			store.set(toggleShellModeAtom)

			// History should be preserved
			const history = store.get(shellHistoryAtom)
			expect(history).toEqual(["cmd1", "cmd2"])
		})

		it("should handle history navigation after clearing history", () => {
			store.set(shellHistoryAtom, ["cmd1", "cmd2"])
			store.set(navigateShellHistoryUpAtom)
			expect(store.get(textBufferStringAtom)).toBe("cmd2")
			const indexBeforeClear = store.get(shellHistoryIndexAtom)

			// Clear history
			store.set(shellHistoryAtom, [])

			// Try to navigate - should return early and not change index
			store.set(navigateShellHistoryUpAtom)
			// Index should remain unchanged when history is empty
			expect(store.get(shellHistoryIndexAtom)).toBe(indexBeforeClear)
		})
	})
})
