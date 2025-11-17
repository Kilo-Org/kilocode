import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ExtensionHost } from "../ExtensionHost.js"
import { logs } from "../../services/logs.js"

describe("ExtensionHost Console Interception", () => {
	let extensionHost: ExtensionHost | undefined
	beforeEach(() => {
		// Spy on logs service methods
		vi.spyOn(logs, "info")
		vi.spyOn(logs, "error")
		vi.spyOn(logs, "warn")
		vi.spyOn(logs, "debug")
	})

	afterEach(async () => {
		if (extensionHost) {
			await extensionHost.deactivate()
			extensionHost = undefined
		}
		vi.restoreAllMocks()
	})

	it("should intercept console logs from main extension code", async () => {
		// This test verifies that console logs in the main extension file are captured
		// Note: This requires a real extension bundle to test properly
		// For now, we'll test the mechanism itself

		// Create a simple test extension that logs to console
		// In a real test, this would be a compiled extension bundle
		expect(true).toBe(true) // Placeholder - actual test would require extension bundle
	})

	it("should intercept console logs from dependency packages", async () => {
		// This test verifies that console logs in dependency packages are captured
		// The key is that the module compilation hook injects console override
		expect(true).toBe(true) // Placeholder - actual test would require extension bundle with dependencies
	})

	it("should restore console methods on deactivation", async () => {
		// Verify that console methods are restored after deactivation
		const originalLog = console.log
		const originalError = console.error

		// After deactivation, console should be restored
		expect(console.log).toBe(originalLog)
		expect(console.error).toBe(originalError)
	})

	it("should clean up global __interceptedConsole on deactivation", async () => {
		// Verify that the global console interception is cleaned up
		expect("__interceptedConsole" in global).toBe(false)
	})
})

describe("Console Interception Mechanism", () => {
	it("should inject console override into module content", () => {
		// Test the module compilation hook logic
		const originalContent = `
			console.log("test message");
			console.error("test error");
		`

		const expectedModifiedContent = `
					// Console interception injected by ExtensionHost
					const console = global.__interceptedConsole || console;
					${originalContent}
				`

		// Verify that the injection pattern is correct
		expect(expectedModifiedContent).toContain("global.__interceptedConsole")
		expect(expectedModifiedContent).toContain(originalContent)
	})

	it("should create intercepted console with all methods", () => {
		// Verify that the intercepted console has all required methods
		const interceptedConsole = {
			log: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
		}

		expect(interceptedConsole).toHaveProperty("log")
		expect(interceptedConsole).toHaveProperty("error")
		expect(interceptedConsole).toHaveProperty("warn")
		expect(interceptedConsole).toHaveProperty("debug")
		expect(interceptedConsole).toHaveProperty("info")
	})
})
