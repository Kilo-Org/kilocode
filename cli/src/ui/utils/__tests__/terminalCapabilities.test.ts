/**
 * Tests for terminal capability detection utilities
 * Including Windows-specific terminal handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Store original values
const originalPlatform = process.platform
const originalEnv = { ...process.env }

/**
 * Helper to mock process.platform
 */
function mockPlatform(platform: NodeJS.Platform) {
	Object.defineProperty(process, "platform", {
		value: platform,
		writable: true,
		configurable: true,
	})
}

/**
 * Helper to restore original platform
 */
function restorePlatform() {
	Object.defineProperty(process, "platform", {
		value: originalPlatform,
		writable: true,
		configurable: true,
	})
}

/**
 * Helper to mock environment variables
 */
function mockEnv(env: Record<string, string | undefined>) {
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}
}

/**
 * Helper to restore original environment
 */
function restoreEnv() {
	// Clear all env vars that weren't in original
	for (const key of Object.keys(process.env)) {
		if (!(key in originalEnv)) {
			delete process.env[key]
		}
	}
	// Restore original values
	for (const [key, value] of Object.entries(originalEnv)) {
		process.env[key] = value
	}
}

describe("terminalCapabilities", () => {
	let writtenData: string[] = []
	let originalWrite: typeof process.stdout.write

	beforeEach(() => {
		writtenData = []
		originalWrite = process.stdout.write
		vi.spyOn(process.stdout, "write").mockImplementation((data: string | Uint8Array) => {
			writtenData.push(data.toString())
			return true
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		restorePlatform()
		restoreEnv()
		process.stdout.write = originalWrite
	})

	describe("Windows platform detection", () => {
		it("should detect Windows platform correctly", () => {
			mockPlatform("win32")
			expect(process.platform).toBe("win32")
		})

		it("should detect non-Windows platform correctly", () => {
			mockPlatform("darwin")
			expect(process.platform).toBe("darwin")

			mockPlatform("linux")
			expect(process.platform).toBe("linux")
		})
	})

	describe("isWindows", () => {
		it("should return true on Windows platform", async () => {
			mockPlatform("win32")
			vi.resetModules()
			const { isWindows } = await import("../terminalCapabilities.js")
			expect(isWindows()).toBe(true)
		})

		it("should return false on non-Windows platforms", async () => {
			mockPlatform("darwin")
			vi.resetModules()
			const { isWindows } = await import("../terminalCapabilities.js")
			expect(isWindows()).toBe(false)
		})
	})

	describe("supportsScrollbackClear", () => {
		it("should return true when WT_SESSION is set (Windows Terminal)", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: "some-session-id" })
			vi.resetModules()
			const { supportsScrollbackClear } = await import("../terminalCapabilities.js")
			expect(supportsScrollbackClear()).toBe(true)
		})

		it("should return true when TERM_PROGRAM is vscode", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: "vscode" })
			vi.resetModules()
			const { supportsScrollbackClear } = await import("../terminalCapabilities.js")
			expect(supportsScrollbackClear()).toBe(true)
		})

		it("should return false on Windows without modern terminal indicators", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { supportsScrollbackClear } = await import("../terminalCapabilities.js")
			expect(supportsScrollbackClear()).toBe(false)
		})

		it("should return true on non-Windows platforms", async () => {
			mockPlatform("darwin")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { supportsScrollbackClear } = await import("../terminalCapabilities.js")
			expect(supportsScrollbackClear()).toBe(true)
		})
	})

	describe("supportsTitleSetting", () => {
		it("should return true when WT_SESSION is set (Windows Terminal)", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: "some-session-id" })
			vi.resetModules()
			const { supportsTitleSetting } = await import("../terminalCapabilities.js")
			expect(supportsTitleSetting()).toBe(true)
		})

		it("should return true when TERM_PROGRAM is vscode", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: "vscode" })
			vi.resetModules()
			const { supportsTitleSetting } = await import("../terminalCapabilities.js")
			expect(supportsTitleSetting()).toBe(true)
		})

		it("should return false on Windows without modern terminal indicators", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { supportsTitleSetting } = await import("../terminalCapabilities.js")
			expect(supportsTitleSetting()).toBe(false)
		})

		it("should return true on non-Windows platforms", async () => {
			mockPlatform("darwin")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { supportsTitleSetting } = await import("../terminalCapabilities.js")
			expect(supportsTitleSetting()).toBe(true)
		})
	})

	describe("getTerminalClearSequence", () => {
		it("should return Windows-compatible clear sequence on legacy Windows (cmd.exe)", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")
			const clearSeq = getTerminalClearSequence()

			// Legacy Windows should NOT use \x1b[3J (clear scrollback) as it causes display issues
			expect(clearSeq).not.toContain("\x1b[3J")
			// Should still clear screen and move cursor home
			expect(clearSeq).toContain("\x1b[2J")
			expect(clearSeq).toContain("\x1b[H")
		})

		it("should return full ANSI clear sequence on Windows Terminal", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: "some-session-id" })
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")
			const clearSeq = getTerminalClearSequence()

			// Windows Terminal supports full clear sequence
			expect(clearSeq).toContain("\x1b[2J")
			expect(clearSeq).toContain("\x1b[3J")
			expect(clearSeq).toContain("\x1b[H")
		})

		it("should return full ANSI clear sequence on VS Code terminal", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: "vscode" })
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")
			const clearSeq = getTerminalClearSequence()

			// VS Code terminal supports full clear sequence
			expect(clearSeq).toContain("\x1b[2J")
			expect(clearSeq).toContain("\x1b[3J")
			expect(clearSeq).toContain("\x1b[H")
		})

		it("should return full ANSI clear sequence on non-Windows platforms", async () => {
			mockPlatform("darwin")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")
			const clearSeq = getTerminalClearSequence()

			// Non-Windows should use full clear sequence including scrollback
			expect(clearSeq).toContain("\x1b[2J")
			expect(clearSeq).toContain("\x1b[3J")
			expect(clearSeq).toContain("\x1b[H")
		})
	})

	describe("normalizeLineEndings", () => {
		it("should convert CRLF to LF", async () => {
			vi.resetModules()
			const { normalizeLineEndings } = await import("../terminalCapabilities.js")

			const input = "line1\r\nline2\r\nline3"
			const result = normalizeLineEndings(input)
			expect(result).toBe("line1\nline2\nline3")
		})

		it("should convert standalone CR to LF", async () => {
			vi.resetModules()
			const { normalizeLineEndings } = await import("../terminalCapabilities.js")

			const input = "line1\rline2\rline3"
			const result = normalizeLineEndings(input)
			expect(result).toBe("line1\nline2\nline3")
		})
	})

	describe("normalizeLineEndingsForOutput", () => {
		it("should convert LF to CRLF on legacy Windows", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\nline2\nline3"
			const result = normalizeLineEndingsForOutput(input)
			expect(result).toBe("line1\r\nline2\r\nline3")
		})

		it("should not convert on Windows Terminal", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: "some-session-id" })
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\nline2\nline3"
			const result = normalizeLineEndingsForOutput(input)
			expect(result).toBe("line1\nline2\nline3")
		})

		it("should not convert on VS Code terminal", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: "vscode" })
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\nline2\nline3"
			const result = normalizeLineEndingsForOutput(input)
			expect(result).toBe("line1\nline2\nline3")
		})

		it("should not double-convert already CRLF strings on legacy Windows", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\r\nline2\r\nline3"
			const result = normalizeLineEndingsForOutput(input)
			// Should not become \r\r\n
			expect(result).toBe("line1\r\nline2\r\nline3")
			expect(result).not.toContain("\r\r\n")
		})
	})

	describe("detectKittyProtocolSupport", () => {
		it("should skip detection and return false on legacy Windows (cmd.exe)", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { detectKittyProtocolSupport } = await import("../terminalCapabilities.js")

			// On legacy Windows, should immediately return false without sending CSI queries
			const result = await detectKittyProtocolSupport()
			expect(result).toBe(false)

			// Should NOT have written any CSI query sequences (which would display as raw text)
			const csiQueries = writtenData.filter((d) => d.includes("\x1b[?u") || d.includes("\x1b[c"))
			expect(csiQueries).toHaveLength(0)
		})
	})

	describe("Windows cmd.exe display bug regression", () => {
		/**
		 * This test verifies the fix for GitHub issue #4697
		 * Windows cmd mode display bug where GUI refreshes fast at the end
		 * with [\r\n\t...] appearing incorrectly
		 */
		it("should not output raw escape sequences that cause display artifacts on legacy Windows", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { getTerminalClearSequence, normalizeLineEndingsForOutput } = await import(
				"../terminalCapabilities.js"
			)

			// Simulate the problematic scenario: long response with mixed line endings
			const longResponse = "This is a long response\nwith multiple lines\nand various content\n".repeat(50)

			// Get the clear sequence
			const clearSeq = getTerminalClearSequence()

			// The clear sequence should not contain problematic sequences for legacy Windows
			// \x1b[3J causes scrollback buffer issues in cmd.exe
			expect(clearSeq).not.toContain("\x1b[3J")

			// Normalize the output for Windows
			const normalizedOutput = normalizeLineEndingsForOutput(longResponse)

			// On legacy Windows, line endings should be CRLF
			expect(normalizedOutput).toContain("\r\n")
			// Should not have bare LF (which causes display issues in cmd.exe)
			const bareLineFeeds = normalizedOutput.match(/(?<!\r)\n/g)
			expect(bareLineFeeds).toBeNull()
		})

		it("should handle rapid updates without display artifacts", async () => {
			mockPlatform("win32")
			mockEnv({ WT_SESSION: undefined, TERM_PROGRAM: undefined })
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")

			// Simulate rapid updates (like streaming)
			const updates: string[] = []
			for (let i = 0; i < 100; i++) {
				const clearSeq = getTerminalClearSequence()
				updates.push(clearSeq)
			}

			// All clear sequences should be consistent
			const uniqueSequences = new Set(updates)
			expect(uniqueSequences.size).toBe(1)

			// The sequence should be Windows-safe for legacy terminals
			const clearSeq = updates[0]
			expect(clearSeq).not.toContain("\x1b[3J")
		})
	})
})
