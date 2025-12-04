import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ExtensionHost } from "../ExtensionHost.js"
import type { ExtensionHostOptions } from "../ExtensionHost.js"
import { logs } from "../../services/logs.js"

describe("ExtensionHost Error Isolation", () => {
	let extensionHost: ExtensionHost
	let mockOptions: ExtensionHostOptions

	beforeEach(() => {
		// Mock logs to prevent console output during tests
		vi.spyOn(logs, "error").mockImplementation(() => {})
		vi.spyOn(logs, "warn").mockImplementation(() => {})
		vi.spyOn(logs, "debug").mockImplementation(() => {})
		vi.spyOn(logs, "info").mockImplementation(() => {})

		mockOptions = {
			workspacePath: "/test/workspace",
			extensionBundlePath: "/test/extension.js",
			extensionRootPath: "/test/extension",
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Error Classification", () => {
		it("should identify task abortion errors as expected", () => {
			extensionHost = new ExtensionHost(mockOptions)
			const isExpectedError = (extensionHost as unknown as { isExpectedError: (error: unknown) => boolean })
				.isExpectedError

			const taskAbortError = new Error("[Task#presentAssistantMessage] task 123.456 aborted")
			expect(isExpectedError(taskAbortError)).toBe(true)
		})

		it("should identify other errors as unexpected", () => {
			extensionHost = new ExtensionHost(mockOptions)
			const isExpectedError = (extensionHost as unknown as { isExpectedError: (error: unknown) => boolean })
				.isExpectedError

			const genericError = new Error("Something went wrong")
			expect(isExpectedError(genericError)).toBe(false)
		})

		it("should handle null/undefined errors", () => {
			extensionHost = new ExtensionHost(mockOptions)
			const isExpectedError = (extensionHost as unknown as { isExpectedError: (error: unknown) => boolean })
				.isExpectedError

			expect(isExpectedError(null)).toBe(false)
			expect(isExpectedError(undefined)).toBe(false)
		})
	})

	describe("Safe Execution", () => {
		it("should execute successful operations normally", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const result = await safeExecute(() => "success", "test-operation")
			expect(result).toBe("success")
		})

		it("should catch and log unexpected errors", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const errorSpy = vi.fn()
			extensionHost.on("extension-error", errorSpy)

			const testError = new Error("Test error")
			const result = await safeExecute(
				() => {
					throw testError
				},
				"test-operation",
				"fallback",
			)

			expect(result).toBe("fallback")
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					context: "test-operation",
					error: testError,
					recoverable: true,
				}),
			)
			expect(logs.error).toHaveBeenCalledWith(
				expect.stringContaining("Extension error in test-operation"),
				"ExtensionHost",
				expect.any(Object),
			)
		})

		it("should not emit events for expected errors", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const errorSpy = vi.fn()
			extensionHost.on("extension-error", errorSpy)

			const taskAbortError = new Error("[Task#presentAssistantMessage] task 123.456 aborted")
			await safeExecute(
				() => {
					throw taskAbortError
				},
				"test-operation",
				"fallback",
			)

			expect(errorSpy).not.toHaveBeenCalled()
			expect(logs.debug).toHaveBeenCalledWith(expect.stringContaining("Expected error"), "ExtensionHost")
		})

		it("should track error count", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const health = (extensionHost as unknown as { extensionHealth: { errorCount: number } }).extensionHealth
			expect(health.errorCount).toBe(0)

			await safeExecute(() => {
				throw new Error("Error 1")
			}, "test-1")
			expect(health.errorCount).toBe(1)

			await safeExecute(() => {
				throw new Error("Error 2")
			}, "test-2")
			expect(health.errorCount).toBe(2)
		})

		it("should update last error information", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const health = (
				extensionHost as unknown as { extensionHealth: { lastError: Error | null; lastErrorTime: number } }
			).extensionHealth
			const testError = new Error("Test error")

			await safeExecute(() => {
				throw testError
			}, "test-operation")

			expect(health.lastError).toBe(testError)
			expect(health.lastErrorTime).toBeGreaterThan(0)
		})
	})

	describe("Error Event Handling", () => {
		it("should emit extension-error events with correct structure", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const errorEvents: Array<{ context: string; error: Error; recoverable: boolean; timestamp: number }> = []
			extensionHost.on("extension-error", (event) => errorEvents.push(event))

			const testError = new Error("Test error")
			await safeExecute(() => {
				throw testError
			}, "test-context")

			expect(errorEvents).toHaveLength(1)
			expect(errorEvents[0]).toMatchObject({
				context: "test-context",
				error: testError,
				recoverable: true,
				timestamp: expect.any(Number),
			})
		})

		it("should not emit legacy error events", async () => {
			extensionHost = new ExtensionHost(mockOptions)
			const safeExecute = (
				extensionHost as unknown as {
					safeExecute: <T>(fn: () => T, context: string, fallback?: T) => Promise<T>
				}
			).safeExecute.bind(extensionHost)

			const errorSpy = vi.fn()
			extensionHost.on("error", errorSpy)

			await safeExecute(() => {
				throw new Error("Test error")
			}, "test-operation")

			// Should not emit legacy "error" event from safeExecute
			expect(errorSpy).not.toHaveBeenCalled()
		})
	})

	describe("Health Tracking", () => {
		it("should initialize with healthy state", () => {
			extensionHost = new ExtensionHost(mockOptions)
			const health = (
				extensionHost as unknown as {
					extensionHealth: {
						isHealthy: boolean
						errorCount: number
						lastError: Error | null
						lastErrorTime: number
					}
				}
			).extensionHealth

			expect(health.isHealthy).toBe(true)
			expect(health.errorCount).toBe(0)
			expect(health.lastError).toBeNull()
			expect(health.lastErrorTime).toBe(0)
		})

		it("should provide health information", () => {
			extensionHost = new ExtensionHost(mockOptions)
			const health = (
				extensionHost as unknown as {
					extensionHealth: {
						isHealthy: boolean
						errorCount: number
						lastError: Error | null
						lastErrorTime: number
						maxErrorsBeforeWarning: number
					}
				}
			).extensionHealth

			expect(health).toMatchObject({
				isHealthy: true,
				errorCount: 0,
				lastError: null,
				lastErrorTime: 0,
				maxErrorsBeforeWarning: 10,
			})
		})
	})
})
