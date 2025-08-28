import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDefaultKeybindingForCommand, getCurrentKeybindingLabel } from "../keybindings"
import { readUserKeybindings } from "../vscode-config"

vi.mock("../vscode-config", () => ({
	readUserKeybindings: vi.fn(),
}))

describe("keybindings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getDefaultKeybindingForCommand", () => {
		it("should return formatted keybinding for terminal command", () => {
			const result = getDefaultKeybindingForCommand("kilo-code.generateTerminalCommand")
			expect(result).toBe("Cmd+Shift+G")
		})

		it("should throw error for non-existent command", () => {
			expect(() => {
				getDefaultKeybindingForCommand("non.existent.command")
			}).toThrow("Command 'non.existent.command' not found in package.json keybindings")
		})
	})

	describe("getCurrentKeybindingLabel", () => {
		it("should return default keybinding when no user keybinding exists", async () => {
			vi.mocked(readUserKeybindings).mockResolvedValue([])

			const result = await getCurrentKeybindingLabel("kilo-code.generateTerminalCommand")
			expect(result).toBe("Cmd+Shift+G")
		})

		it("should return user keybinding when available", async () => {
			vi.mocked(readUserKeybindings).mockResolvedValue([
				{ key: "ctrl+shift+t", command: "kilo-code.generateTerminalCommand" },
			])

			const result = await getCurrentKeybindingLabel("kilo-code.generateTerminalCommand")
			expect(result).toBe("Ctrl+Shift+T")
		})

		it("should return undefined for non-existent command", async () => {
			vi.mocked(readUserKeybindings).mockResolvedValue([])

			const result = await getCurrentKeybindingLabel("non.existent.command")
			expect(result).toBeUndefined()
		})
	})
})
