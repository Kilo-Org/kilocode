/**
 * Tests for terminal theme detection utility
 */

import {
	detectTerminalThemeSync,
	detectTerminalTheme,
	getThemeIdForTerminal,
} from "../utils/terminal-theme-detection.js"

describe("terminal-theme-detection", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Reset environment before each test
		process.env = { ...originalEnv }
		// Clear all theme-related env vars
		delete process.env.COLORFGBG
		delete process.env.TERM_PROGRAM
		delete process.env.VSCODE_TERMINAL_THEME
		delete process.env.ITERM_PROFILE
		delete process.env.HYPER_THEME
		delete process.env.WT_SESSION
		delete process.env.WT_PROFILE_ID
		delete process.env.KITTY_WINDOW_ID
		delete process.env.KITTY_THEME
		delete process.env.ALACRITTY_SOCKET
		delete process.env.ALACRITTY_THEME
		delete process.env.TERMINAL_THEME
		delete process.env.TERM_THEME
	})

	afterAll(() => {
		process.env = originalEnv
	})

	describe("detectTerminalThemeSync", () => {
		describe("COLORFGBG detection", () => {
			it("should detect dark theme from COLORFGBG=15;0 (white on black)", () => {
				process.env.COLORFGBG = "15;0"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from COLORFGBG=0;15 (black on white)", () => {
				process.env.COLORFGBG = "0;15"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from COLORFGBG=7;0 (light gray on black)", () => {
				process.env.COLORFGBG = "7;0"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from COLORFGBG=0;7 (black on light gray)", () => {
				process.env.COLORFGBG = "0;7"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should handle COLORFGBG with cursor color (3 parts)", () => {
				process.env.COLORFGBG = "15;0;0"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect dark theme from low grayscale background (232-243)", () => {
				process.env.COLORFGBG = "15;235"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from high grayscale background (244-255)", () => {
				process.env.COLORFGBG = "0;253"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should return null for invalid COLORFGBG format", () => {
				process.env.COLORFGBG = "invalid"
				expect(detectTerminalThemeSync()).toBeNull()
			})

			it("should return null for COLORFGBG with only one value", () => {
				process.env.COLORFGBG = "15"
				expect(detectTerminalThemeSync()).toBeNull()
			})
		})

		describe("terminal-specific env var detection", () => {
			it("should detect dark theme from VS Code terminal", () => {
				process.env.TERM_PROGRAM = "vscode"
				process.env.VSCODE_TERMINAL_THEME = "dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from VS Code terminal", () => {
				process.env.TERM_PROGRAM = "vscode"
				process.env.VSCODE_TERMINAL_THEME = "light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from iTerm2 profile", () => {
				process.env.TERM_PROGRAM = "iTerm.app"
				process.env.ITERM_PROFILE = "Solarized Dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from iTerm2 profile", () => {
				process.env.TERM_PROGRAM = "iTerm.app"
				process.env.ITERM_PROFILE = "Solarized Light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from Hyper terminal", () => {
				process.env.TERM_PROGRAM = "Hyper"
				process.env.HYPER_THEME = "hyper-snazzy-dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from Hyper terminal", () => {
				process.env.TERM_PROGRAM = "Hyper"
				process.env.HYPER_THEME = "hyper-light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from Windows Terminal profile", () => {
				process.env.WT_SESSION = "some-session-id"
				process.env.WT_PROFILE_ID = "one-half-dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from Windows Terminal profile", () => {
				process.env.WT_SESSION = "some-session-id"
				process.env.WT_PROFILE_ID = "one-half-light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from Kitty terminal", () => {
				process.env.KITTY_WINDOW_ID = "1"
				process.env.KITTY_THEME = "Dracula"
				// Dracula doesn't contain "light", so defaults to dark
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from Kitty terminal", () => {
				process.env.KITTY_WINDOW_ID = "1"
				process.env.KITTY_THEME = "Solarized Light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from generic TERMINAL_THEME", () => {
				process.env.TERMINAL_THEME = "dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from generic TERMINAL_THEME", () => {
				process.env.TERMINAL_THEME = "light"
				expect(detectTerminalThemeSync()).toBe("light")
			})

			it("should detect dark theme from generic TERM_THEME", () => {
				process.env.TERM_THEME = "monokai-dark"
				expect(detectTerminalThemeSync()).toBe("dark")
			})

			it("should detect light theme from generic TERM_THEME", () => {
				process.env.TERM_THEME = "github-light"
				expect(detectTerminalThemeSync()).toBe("light")
			})
		})

		describe("priority order", () => {
			it("should prioritize COLORFGBG over terminal-specific vars", () => {
				process.env.COLORFGBG = "0;15" // light
				process.env.TERMINAL_THEME = "dark"
				expect(detectTerminalThemeSync()).toBe("light")
			})
		})

		describe("no detection available", () => {
			it("should return null when no theme can be detected", () => {
				// No env vars set, and we're not on macOS (or can't detect)
				// This test may behave differently on macOS
				if (process.platform !== "darwin") {
					expect(detectTerminalThemeSync()).toBeNull()
				}
			})
		})
	})

	describe("detectTerminalTheme (async)", () => {
		it("should return detected theme from sync methods", async () => {
			process.env.COLORFGBG = "15;0"
			const result = await detectTerminalTheme()
			expect(result).toBe("dark")
		})

		it("should default to dark when no detection available", async () => {
			// Clear all env vars and skip OSC query
			if (process.platform !== "darwin") {
				const result = await detectTerminalTheme({ useOscQuery: false })
				expect(result).toBe("dark")
			}
		})

		it("should respect useOscQuery option", async () => {
			// When useOscQuery is false, should not attempt OSC query
			const result = await detectTerminalTheme({ useOscQuery: false })
			expect(["dark", "light"]).toContain(result)
		})
	})

	describe("getThemeIdForTerminal", () => {
		it("should return 'dark' for dark theme", () => {
			expect(getThemeIdForTerminal("dark")).toBe("dark")
		})

		it("should return 'light' for light theme", () => {
			expect(getThemeIdForTerminal("light")).toBe("light")
		})
	})

	describe("color cube detection", () => {
		it("should detect dark theme from dark color cube colors", () => {
			// Color 16 is the first color in the cube (black)
			process.env.COLORFGBG = "15;16"
			expect(detectTerminalThemeSync()).toBe("dark")
		})

		it("should detect light theme from light color cube colors", () => {
			// Color 231 is the last color in the cube (white)
			process.env.COLORFGBG = "0;231"
			expect(detectTerminalThemeSync()).toBe("light")
		})

		it("should detect dark theme from mid-dark color cube colors", () => {
			// Color 52 is a dark red
			process.env.COLORFGBG = "15;52"
			expect(detectTerminalThemeSync()).toBe("dark")
		})

		it("should detect light theme from mid-light color cube colors", () => {
			// Color 188 is a light gray-ish color
			process.env.COLORFGBG = "0;188"
			expect(detectTerminalThemeSync()).toBe("light")
		})
	})
})
