import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { LogsService } from "../logs.js"

describe("LogsService", () => {
	let logsService: LogsService

	beforeEach(() => {
		// Get a fresh instance for each test
		logsService = LogsService.getInstance()
	})

	afterEach(() => {
		// Clean up test logs
		logsService.clear()
	})

	describe("Circular Reference Handling", () => {
		it("should handle circular references in objects", () => {
			const obj: Record<string, unknown> = { name: "test" }
			obj.self = obj // Create circular reference

			// This should not throw
			expect(() => {
				logsService.info("Test circular reference", "test", { obj })
			}).not.toThrow()

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.context?.obj).toBeDefined()
		})

		it("should handle circular references in arrays", () => {
			const arr: unknown[] = [1, 2, 3]
			arr.push(arr) // Create circular reference

			expect(() => {
				logsService.info("Test circular array", "test", { arr })
			}).not.toThrow()

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
		})

		it("should handle deeply nested circular references", () => {
			const obj1: Record<string, unknown> = { name: "obj1" }
			const obj2: Record<string, unknown> = { name: "obj2", parent: obj1 }
			obj1.child = obj2
			obj2.circular = obj1 // Create circular reference

			expect(() => {
				logsService.info("Test nested circular", "test", { obj1 })
			}).not.toThrow()

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
		})

		it("should handle circular references in complex objects like ExtensionContext", () => {
			// Simulate a VSCode ExtensionContext-like object with circular references
			const mockContext: Record<string, unknown> = {
				subscriptions: [],
				workspaceState: {},
				globalState: {},
			}

			const mockSubscription = {
				dispose: () => {},
				context: mockContext,
			}

			;(mockContext.subscriptions as unknown[]).push(mockSubscription)

			expect(() => {
				logsService.error("Extension error", "test", { context: mockContext })
			}).not.toThrow()

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.level).toBe("error")
		})
	})

	describe("Error Serialization", () => {
		it("should serialize Error objects correctly", () => {
			const error = new Error("Test error")
			error.stack = "Error: Test error\n    at test.ts:1:1"

			logsService.error("Error occurred", "test", { error })

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			const context = logs[0]?.context as { error: { message: string; name: string; stack: string } }
			expect(context.error.message).toBe("Test error")
			expect(context.error.name).toBe("Error")
			expect(context.error.stack).toContain("Error: Test error")
		})

		it("should handle custom error properties", () => {
			class CustomError extends Error {
				code: string
				constructor(message: string, code: string) {
					super(message)
					this.name = "CustomError"
					this.code = code
				}
			}

			const error = new CustomError("Custom error", "ERR_CUSTOM")

			logsService.error("Custom error occurred", "test", { error })

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			const context = logs[0]?.context as { error: { message: string; name: string; code: string } }
			expect(context.error.message).toBe("Custom error")
			expect(context.error.name).toBe("CustomError")
			expect(context.error.code).toBe("ERR_CUSTOM")
		})
	})

	describe("Special Object Types", () => {
		it("should handle Date objects", () => {
			const date = new Date("2024-01-01T00:00:00.000Z")

			logsService.info("Date test", "test", { date })

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			const context = logs[0]?.context as { date: string }
			expect(context.date).toBe("2024-01-01T00:00:00.000Z")
		})

		it("should handle RegExp objects", () => {
			const regex = /test\d+/gi

			logsService.info("RegExp test", "test", { regex })

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			const context = logs[0]?.context as { regex: string }
			expect(context.regex).toBe("/test\\d+/gi")
		})

		it("should handle null and undefined", () => {
			logsService.info("Null/undefined test", "test", {
				nullValue: null,
				undefinedValue: undefined,
			})

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			const context = logs[0]?.context as { nullValue: null; undefinedValue: undefined }
			expect(context.nullValue).toBeNull()
			expect(context.undefinedValue).toBeUndefined()
		})
	})

	describe("Basic Logging", () => {
		it("should log info messages", () => {
			logsService.info("Test info", "test")

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.level).toBe("info")
			expect(logs[0]?.message).toBe("Test info")
			expect(logs[0]?.source).toBe("test")
		})

		it("should log debug messages", () => {
			logsService.debug("Test debug", "test")

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.level).toBe("debug")
		})

		it("should log error messages", () => {
			logsService.error("Test error", "test")

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.level).toBe("error")
		})

		it("should log warn messages", () => {
			logsService.warn("Test warn", "test")

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(1)
			expect(logs[0]?.level).toBe("warn")
		})
	})

	describe("Log Management", () => {
		it("should maintain max entries limit", () => {
			logsService.setMaxEntries(5)

			for (let i = 0; i < 10; i++) {
				logsService.info(`Message ${i}`, "test")
			}

			const logs = logsService.getLogs()
			expect(logs.length).toBeLessThanOrEqual(5)
		})

		it("should clear all logs", () => {
			logsService.info("Test 1", "test")
			logsService.info("Test 2", "test")

			logsService.clear()

			const logs = logsService.getLogs()
			expect(logs).toHaveLength(0)
		})

		it("should filter logs by level", () => {
			logsService.info("Info message", "test")
			logsService.error("Error message", "test")
			logsService.debug("Debug message", "test")

			const errorLogs = logsService.getLogs({ levels: ["error"] })
			expect(errorLogs).toHaveLength(1)
			expect(errorLogs[0]?.level).toBe("error")
		})

		it("should filter logs by source", () => {
			logsService.info("Message 1", "source1")
			logsService.info("Message 2", "source2")
			logsService.info("Message 3", "source1")

			const source1Logs = logsService.getLogs({ source: "source1" })
			expect(source1Logs).toHaveLength(2)
		})
	})

	describe("Subscriptions", () => {
		it("should notify subscribers of new logs", () => {
			const listener = vi.fn()
			const unsubscribe = logsService.subscribe(listener)

			logsService.info("Test message", "test")

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					level: "info",
					message: "Test message",
					source: "test",
				}),
			)

			unsubscribe()
		})

		it("should allow unsubscribing", () => {
			const listener = vi.fn()
			const unsubscribe = logsService.subscribe(listener)

			logsService.info("Message 1", "test")
			unsubscribe()
			logsService.info("Message 2", "test")

			expect(listener).toHaveBeenCalledTimes(1)
		})
	})
})
