/**
 * Tests for terminal capability detection utilities
 * Including Windows-specific terminal handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Store original platform
const originalPlatform = process.platform

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
		process.stdout.write = originalWrite
	})

	describe("Windows terminal detection", () => {
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

	describe("isWindowsTerminal", () => {
		it("should return true on Windows platform", async () => {
			mockPlatform("win32")
			const { isWindowsTerminal } = await import("../terminalCapabilities.js")
			expect(isWindowsTerminal()).toBe(true)
		})

		it("should return false on non-Windows platforms", async () => {
			mockPlatform("darwin")
			// Need to re-import to get fresh module state
			vi.resetModules()
			const { isWindowsTerminal } = await import("../terminalCapabilities.js")
			expect(isWindowsTerminal()).toBe(false)
		})
	})

	describe("getTerminalClearSequence", () => {
		it("should return Windows-compatible clear sequence on Windows", async () => {
			mockPlatform("win32")
			vi.resetModules()
			const { getTerminalClearSequence } = await import("../terminalCapabilities.js")
			const clearSeq = getTerminalClearSequence()

			// Windows should NOT use \x1b[3J (clear scrollback) as it causes display issues
			// in cmd.exe and older Windows terminals
			expect(clearSeq).not.toContain("\x1b[3J")
			// Should still clear screen and move cursor home
			expect(clearSeq).toContain("\x1b[2J")
			expect(clearSeq).toContain("\x1b[H")
		})

		it("should return full ANSI clear sequence on non-Windows platforms", async () => {
			mockPlatform("darwin")
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
		it("should convert CRLF to LF on non-Windows platforms", async () => {
			mockPlatform("darwin")
			vi.resetModules()
			const { normalizeLineEndings } = await import("../terminalCapabilities.js")

			const input = "line1\r\nline2\r\nline3"
			const result = normalizeLineEndings(input)
			expect(result).toBe("line1\nline2\nline3")
		})

		it("should preserve CRLF on Windows for output", async () => {
			mockPlatform("win32")
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\nline2\nline3"
			const result = normalizeLineEndingsForOutput(input)
			expect(result).toBe("line1\r\nline2\r\nline3")
		})

		it("should not double-convert already CRLF strings on Windows", async () => {
			mockPlatform("win32")
			vi.resetModules()
			const { normalizeLineEndingsForOutput } = await import("../terminalCapabilities.js")

			const input = "line1\r\nline2\r\nline3"
			const result = normalizeLineEndingsForOutput(input)
			// Should not become \r\r\n
			expect(result).toBe("line1\r\nline2\r\nline3")
			expect(result).not.toContain("\r\r\n")
		})
	})

	describe("Windows cmd.exe display bug regression", () => {
		/**
		 * This test verifies the fix for GitHub issue #4697
		 * Windows cmd mode display bug where GUI refreshes fast at the end
		 * with [\r\n\t...] appearing incorrectly
		 */
		it("should not output raw escape sequences that cause display artifacts on Windows", async () => {
			mockPlatform("win32")
			vi.resetModules()
			const { getTerminalClearSequence, normalizeLineEndingsForOutput } = await import(
				"../terminalCapabilities.js"
			)

			// Simulate the problematic scenario: long response with mixed line endings
			const longResponse = "This is a long response\nwith multiple lines\nand various content\n".repeat(50)

			// Get the clear sequence
			const clearSeq = getTerminalClearSequence()

			// The clear sequence should not contain problematic sequences for Windows
			// \x1b[3J causes scrollback buffer issues in cmd.exe
			expect(clearSeq).not.toContain("\x1b[3J")

			// Normalize the output for Windows
			const normalizedOutput = normalizeLineEndingsForOutput(longResponse)

			// On Windows, line endings should be CRLF
			expect(normalizedOutput).toContain("\r\n")
			// Should not have bare LF (which causes display issues in cmd.exe)
			const bareLineFeeds = normalizedOutput.match(/(?<!\r)\n/g)
			expect(bareLineFeeds).toBeNull()
		})

		it("should handle rapid updates without display artifacts", async () => {
			mockPlatform("win32")
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

			// The sequence should be Windows-safe
			const clearSeq = updates[0]
			expect(clearSeq).not.toContain("\x1b[3J")
		})
	})
})
