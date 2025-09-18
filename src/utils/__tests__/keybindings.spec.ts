import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getKeybindingsForCommands, getKeybindingForCommand } from "../keybindings"
import * as vscodeConfig from "../vscode-config"

vi.mock("../vscode-config")

describe("keybindings", () => {
	const originalPlatform = process.platform

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
	})

	describe("getKeybindingForCommand", () => {
		it("should return user keybinding when available", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: "ctrl+k" }])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBe("Ctrl+K")
		})

		it("should return formatted keybinding with multiple modifiers", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([
				{ command: "test.command", key: "ctrl+shift+alt+k" },
			])

			const result = await getKeybindingForCommand("test.command")
			// On macOS, alt maps to Option; on other platforms, it stays Alt
			const expected = process.platform === "darwin" ? "Ctrl+Shift+Option+K" : "Ctrl+Shift+Alt+K"
			expect(result).toBe(expected)
		})

		it("should handle chord keybindings", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([
				{ command: "test.command", key: "ctrl+k ctrl+s" },
			])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBe("Ctrl+K, Ctrl+S")
		})

		it("should handle platform differences for cmd key", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: "cmd+k" }])

			Object.defineProperty(process, "platform", { value: "darwin" })
			const macResult = await getKeybindingForCommand("test.command")
			expect(macResult).toBe("Cmd+K")

			Object.defineProperty(process, "platform", { value: "win32" })
			const winResult = await getKeybindingForCommand("test.command")
			expect(winResult).toBe("Win+K")
		})

		it("should throw error when unable to read keybindings file", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockRejectedValue(new Error("File not found"))

			await expect(getKeybindingForCommand("test.command")).rejects.toThrow(
				"Unable to read keybindings file: File not found",
			)
		})
	})

	describe("explicit unbinding behavior", () => {
		it("should return undefined", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: "" }])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBeUndefined()
		})

		it("should distinguish between undefined key and empty string key", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: undefined }])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBeUndefined()
		})
	})

	describe("getKeybindingsForCommands", () => {
		it("should return keybindings for multiple commands", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([
				{ command: "test.command1", key: "ctrl+k" },
				{ command: "test.command2", key: "ctrl+shift+p" },
			])

			const result = await getKeybindingsForCommands(["test.command1", "test.command2"])
			expect(result).toEqual({
				"test.command1": "Ctrl+K",
				"test.command2": "Ctrl+Shift+P",
			})
		})

		it("should handle empty command list", async () => {
			const result = await getKeybindingsForCommands([])
			expect(result).toEqual({})
		})

		it("should throw error for commands without keybindings", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command1", key: "ctrl+k" }])

			await expect(getKeybindingsForCommands(["test.command1", "test.command2"])).rejects.toThrow(
				"Command 'test.command2' not found in package.json keybindings",
			)
		})
	})

	describe("key normalization", () => {
		it("should normalize special keys", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([
				{ command: "test.command", key: "ctrl+left" },
			])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBe("Ctrl+Left")
		})

		it("should handle function keys", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: "f12" }])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBe("F12")
		})

		it("should capitalize regular keys", async () => {
			vi.mocked(vscodeConfig.readUserConfigFile).mockResolvedValue([{ command: "test.command", key: "ctrl+a" }])

			const result = await getKeybindingForCommand("test.command")
			expect(result).toBe("Ctrl+A")
		})
	})
})
