import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	shellModeActiveAtom,
	shellHistoryAtom,
	toggleShellModeAtom,
	executeShellCommandAtom,
	keyboardHandlerAtom,
} from "../keyboard.js"
import { inputModeAtom } from "../ui.js"
import type { Key } from "../../../types/keyboard.js"

// Mock child_process to avoid actual command execution
vi.mock("child_process", () => ({
	exec: vi.fn((command, callback) => {
		// Simulate successful command execution
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
		if (callback) {
			callback(process)
		}
		return process
	}),
}))

describe("shell mode - essential tests", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		// Clear shell history before each test
		store.set(shellHistoryAtom, [])
		store.set(shellModeActiveAtom, false)
		store.set(inputModeAtom, "normal" as const)
	})

	describe("shell mode activation", () => {
		it("should toggle shell mode on and off", () => {
			// Initial state
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")

			// Toggle on
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")

			// Toggle off
			store.set(toggleShellModeAtom)
			expect(store.get(shellModeActiveAtom)).toBe(false)
			expect(store.get(inputModeAtom)).toBe("normal")
		})

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
	})

	describe("Shift+1 key detection", () => {
		it("should detect Shift+1 and toggle shell mode", async () => {
			const shift1Key: Key = {
				name: "shift-1",
				sequence: "!",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
			}

			// Press Shift+1
			await store.set(keyboardHandlerAtom, shift1Key)

			// Should activate shell mode
			expect(store.get(shellModeActiveAtom)).toBe(true)
			expect(store.get(inputModeAtom)).toBe("shell")
		})
	})
})
