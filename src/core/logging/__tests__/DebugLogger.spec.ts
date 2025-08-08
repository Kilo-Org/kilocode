import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { logConfig, logTask, logTool, logVSCodeAPI, logPermission } from "../DebugLogger"

describe("DebugLogger", () => {
	let consoleSpy: any
	let originalEnv: string | undefined

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		originalEnv = process.env.KILO_CLI
	})

	afterEach(() => {
		consoleSpy.mockRestore()
		process.env.KILO_CLI = originalEnv
	})

	describe("CLI Mode", () => {
		beforeEach(() => {
			process.env.KILO_CLI = "true"
		})

		it("should have logging functions available", () => {
			expect(typeof logConfig).toBe("function")
			expect(typeof logTask).toBe("function")
			expect(typeof logTool).toBe("function")
			expect(typeof logVSCodeAPI).toBe("function")
			expect(typeof logPermission).toBe("function")
		})

		it("should not log in production mode", () => {
			logConfig("get", "test.setting", "value")
			logTask("task-123", "start", { hasProvider: true })
			logTool("readFile", "execute", { path: "/test/file.txt" })
			logVSCodeAPI("workspace.getConfiguration", { section: "test" })
			logPermission("file-read", "/test/file.txt", true)

			// All logging is disabled in production
			expect(consoleSpy).not.toHaveBeenCalled()
		})
	})
})
