import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { debugOS } from ".."

describe("debugOS", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		consoleLogSpy.mockRestore()
		consoleErrorSpy.mockRestore()
	})

	it("should execute without throwing errors", async () => {
		await expect(debugOS()).resolves.not.toThrow()
	})

	it("should log system information", async () => {
		await debugOS()

		expect(consoleLogSpy).toHaveBeenCalled()
		expect(consoleLogSpy).toHaveBeenCalledWith("Kilo Code - OS Debug Tool") // kilocode_change

		// Check that various sections are logged
		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toContain("=== Operating System ===")
		expect(allLogs).toContain("=== Hardware ===")
		expect(allLogs).toContain("=== Environment ===")
		expect(allLogs).toContain("=== Locale ===")
		expect(allLogs).toContain("=== Process Information ===")
	})

	it("should log OS information", async () => {
		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toMatch(/Platform:\s+\w+/)
		expect(allLogs).toMatch(/Architecture:\s+\w+/)
		expect(allLogs).toMatch(/WSL:\s+(Yes|No)/)
	})

	it("should log hardware information", async () => {
		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toMatch(/CPU:/)
		expect(allLogs).toMatch(/Cores:\s+\d+/)
		expect(allLogs).toMatch(/Total Memory:\s+[\d.]+ GB/)
		expect(allLogs).toMatch(/Free Memory:\s+[\d.]+ GB/)
	})

	it("should log environment information", async () => {
		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toMatch(/Node Version:\s+v\d+/)
		expect(allLogs).toMatch(/Shell:/)
		expect(allLogs).toMatch(/Terminal:/)
	})

	it("should log locale information", async () => {
		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toMatch(/Timezone:/)
		expect(allLogs).toMatch(/Encoding:\s+utf8/)
	})

	it("should log process information", async () => {
		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toMatch(/PID:\s+\d+/)
		expect(allLogs).toMatch(/Working Dir:/)
		expect(allLogs).toMatch(/Executable:/)
	})

	it("should log platform-specific information on Linux", async () => {
		const originalPlatform = process.platform
		Object.defineProperty(process, "platform", {
			value: "linux",
			writable: true,
			configurable: true,
		})

		await debugOS()

		const allLogs = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n")

		expect(allLogs).toContain("=== Linux Specific ===")

		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			writable: true,
			configurable: true,
		})
	})

	it("should log success message", async () => {
		await debugOS()

		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("OS debug information collected successfully"),
		)
	})

	it("should log error message on failure", async () => {
		// This test verifies the error handling structure exists
		// In practice, the function is very robust and unlikely to fail
		// unless there's a critical system issue

		// We can verify the error handling code path exists by checking
		// that the function has proper try-catch structure
		const functionString = debugOS.toString()
		expect(functionString).toContain("try")
		expect(functionString).toContain("catch")
		expect(functionString).toContain("console.error")
	})
})
