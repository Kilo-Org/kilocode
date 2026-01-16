// kilocode_change - new file
/**
 * Tests for terminal theme detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { detectTerminalTheme, shouldAutoDetectTheme, resolveTheme } from "../detectTerminalTheme.js"

describe("detectTerminalTheme", () => {
	// Store original environment
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
		// Clear relevant environment variables
		delete process.env.COLORFGBG
		delete process.env.TERM_PROGRAM
		delete process.env.WT_SESSION
		delete process.env.ALACRITTY_SOCKET
		delete process.env.ALACRITTY_LOG
		delete process.env.KITTY_WINDOW_ID
		delete process.env.TMUX
	})

	afterEach(() => {
		process.env = originalEnv
	})

	describe("COLORFGBG detection", () => {
		it("should detect dark theme from COLORFGBG with dark background (15;0)", () => {
			process.env.COLORFGBG = "15;0"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect light theme from COLORFGBG with light background (0;15)", () => {
			process.env.COLORFGBG = "0;15"
			expect(detectTerminalTheme()).toBe("light")
		})

		it("should detect dark theme from COLORFGBG with low background value", () => {
			process.env.COLORFGBG = "7;0"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect light theme from COLORFGBG with high background value", () => {
			process.env.COLORFGBG = "0;8"
			expect(detectTerminalTheme()).toBe("light")
		})

		it("should detect light theme from COLORFGBG 0;10", () => {
			process.env.COLORFGBG = "0;10"
			expect(detectTerminalTheme()).toBe("light")
		})

		it("should handle invalid COLORFGBG format gracefully", () => {
			process.env.COLORFGBG = "invalid"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should handle COLORFGBG with only one value", () => {
			process.env.COLORFGBG = "15"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should handle COLORFGBG with non-numeric values", () => {
			process.env.COLORFGBG = "abc;xyz"
			expect(detectTerminalTheme()).toBe("dark")
		})
	})

	describe("TERM_PROGRAM detection", () => {
		it("should detect dark theme for Apple Terminal", () => {
			process.env.TERM_PROGRAM = "Apple_Terminal"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for iTerm2", () => {
			process.env.TERM_PROGRAM = "iTerm.app"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for VS Code terminal", () => {
			process.env.TERM_PROGRAM = "vscode"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for Hyper", () => {
			process.env.TERM_PROGRAM = "Hyper"
			expect(detectTerminalTheme()).toBe("dark")
		})
	})

	describe("Terminal-specific detection", () => {
		it("should detect dark theme for Windows Terminal", () => {
			process.env.WT_SESSION = "some-session-id"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for Alacritty (via ALACRITTY_SOCKET)", () => {
			process.env.ALACRITTY_SOCKET = "/tmp/alacritty.sock"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for Alacritty (via ALACRITTY_LOG)", () => {
			process.env.ALACRITTY_LOG = "/tmp/alacritty.log"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for Kitty", () => {
			process.env.KITTY_WINDOW_ID = "123"
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should detect dark theme for tmux", () => {
			process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
			expect(detectTerminalTheme()).toBe("dark")
		})
	})

	describe("Priority and fallback", () => {
		it("should prioritize COLORFGBG over TERM_PROGRAM", () => {
			process.env.COLORFGBG = "0;15" // light
			process.env.TERM_PROGRAM = "vscode" // would default to dark
			expect(detectTerminalTheme()).toBe("light")
		})

		it("should default to dark when no detection methods available", () => {
			expect(detectTerminalTheme()).toBe("dark")
		})

		it("should use COLORFGBG in tmux", () => {
			process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
			process.env.COLORFGBG = "0;15"
			expect(detectTerminalTheme()).toBe("light")
		})
	})
})

describe("shouldAutoDetectTheme", () => {
	it("should return true for undefined theme", () => {
		expect(shouldAutoDetectTheme(undefined)).toBe(true)
	})

	it("should return true for 'auto' theme", () => {
		expect(shouldAutoDetectTheme("auto")).toBe(true)
	})

	it("should return true for empty string", () => {
		expect(shouldAutoDetectTheme("")).toBe(true)
	})

	it("should return false for 'dark' theme", () => {
		expect(shouldAutoDetectTheme("dark")).toBe(false)
	})

	it("should return false for 'light' theme", () => {
		expect(shouldAutoDetectTheme("light")).toBe(false)
	})

	it("should return false for custom theme names", () => {
		expect(shouldAutoDetectTheme("dracula")).toBe(false)
		expect(shouldAutoDetectTheme("github-dark")).toBe(false)
	})
})

describe("resolveTheme", () => {
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
		delete process.env.COLORFGBG
		delete process.env.TERM_PROGRAM
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should auto-detect theme when config is undefined", () => {
		process.env.COLORFGBG = "0;15" // light background
		expect(resolveTheme(undefined)).toBe("light")
	})

	it("should auto-detect theme when config is 'auto'", () => {
		process.env.COLORFGBG = "15;0" // dark background
		expect(resolveTheme("auto")).toBe("dark")
	})

	it("should auto-detect theme when config is empty string", () => {
		process.env.COLORFGBG = "0;15" // light background
		expect(resolveTheme("")).toBe("light")
	})

	it("should use configured theme when explicitly set", () => {
		process.env.COLORFGBG = "0;15" // light background
		expect(resolveTheme("dark")).toBe("dark") // should not auto-detect
	})

	it("should use custom theme names", () => {
		process.env.COLORFGBG = "15;0" // dark background
		expect(resolveTheme("dracula")).toBe("dracula")
		expect(resolveTheme("github-dark")).toBe("github-dark")
	})
})
