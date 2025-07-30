import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import { MemoryService } from "../MemoryService"

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(),
		instance: {
			captureMemoryUsage: vi.fn(),
		},
	},
}))

describe("MemoryService", () => {
	let memoryService: MemoryService
	let mockContext: vscode.ExtensionContext
	let mockTelemetryService: any

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		mockContext = {
			subscriptions: [],
		} as any

		mockTelemetryService = TelemetryService as any
		mockTelemetryService.hasInstance.mockReturnValue(true)

		memoryService = new MemoryService(mockContext)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("start", () => {
		it("should start memory monitoring and report initial usage", () => {
			memoryService.start()

			expect(mockTelemetryService.instance.captureMemoryUsage).toHaveBeenCalledTimes(1)
		})

		it("should not start if already running", () => {
			memoryService.start()
			vi.clearAllMocks()

			memoryService.start()

			// Service should not report again when already running
			expect(mockTelemetryService.instance.captureMemoryUsage).not.toHaveBeenCalled()
		})

		it("should register cleanup with context subscriptions", () => {
			memoryService.start()

			expect(mockContext.subscriptions).toHaveLength(1)
			expect(mockContext.subscriptions[0]).toHaveProperty("dispose")
		})

		it("should report memory usage periodically", () => {
			memoryService.start()
			vi.clearAllMocks()

			// Fast-forward 1 minute
			vi.advanceTimersByTime(60 * 1000)

			expect(mockTelemetryService.instance.captureMemoryUsage).toHaveBeenCalledTimes(1)
		})
	})

	describe("stop", () => {
		it("should stop memory monitoring", () => {
			memoryService.start()
			memoryService.stop()

			// Verify that subsequent timer ticks don't report memory usage
			vi.clearAllMocks()
			vi.advanceTimersByTime(60 * 1000)
			expect(mockTelemetryService.instance.captureMemoryUsage).not.toHaveBeenCalled()
		})

		it("should not report memory usage after stopping", () => {
			memoryService.start()
			memoryService.stop()
			vi.clearAllMocks()

			// Fast-forward 1 minute
			vi.advanceTimersByTime(60 * 1000)

			expect(mockTelemetryService.instance.captureMemoryUsage).not.toHaveBeenCalled()
		})
	})

	describe("memory reporting", () => {
		it("should convert memory usage from bytes to megabytes", () => {
			// Mock process.memoryUsage to return known values
			const originalMemoryUsage = process.memoryUsage
			process.memoryUsage = vi.fn(() => ({
				heapUsed: 10 * 1024 * 1024, // 10 MB
				heapTotal: 20 * 1024 * 1024, // 20 MB
				external: 5 * 1024 * 1024, // 5 MB
				rss: 30 * 1024 * 1024, // 30 MB
				arrayBuffers: 0,
			})) as any

			memoryService.start()

			expect(mockTelemetryService.instance.captureMemoryUsage).toHaveBeenCalledWith({
				heapUsed: 10,
				heapTotal: 20,
				external: 5,
				rss: 30,
			})

			// Restore original function
			process.memoryUsage = originalMemoryUsage
		})

		it("should handle telemetry service not being available", () => {
			mockTelemetryService.hasInstance.mockReturnValue(false)

			expect(() => memoryService.start()).not.toThrow()
		})

		it("should handle errors gracefully", () => {
			// Mock console.error to verify error handling
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Mock process.memoryUsage to throw an error
			const originalMemoryUsage = process.memoryUsage
			process.memoryUsage = vi.fn(() => {
				throw new Error("Memory access failed")
			}) as any

			memoryService.start()

			expect(consoleSpy).toHaveBeenCalledWith(
				"[MemoryService] Error reporting memory usage: Memory access failed",
			)

			// Restore original functions
			process.memoryUsage = originalMemoryUsage
			consoleSpy.mockRestore()
		})
	})
})
