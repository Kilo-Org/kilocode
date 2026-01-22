// kilocode_change - new file
import { captureLlmErrorTelemetry, isLlmErrorTelemetryCaptured } from "../llm-error-telemetry"
import { TelemetryService } from "@roo-code/telemetry"

// Mock the TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureLlmError: vi.fn(),
		},
	},
}))

// Mock the @roo-code/types functions
vi.mock("@roo-code/types", async () => {
	const actual = await vi.importActual("@roo-code/types")
	return {
		...actual,
		getErrorStatusCode: vi.fn((error: any) => error?.status),
		getErrorMessage: vi.fn((error: any) => error?.message),
		shouldReportApiErrorToTelemetry: vi.fn(() => true),
	}
})

describe("llm-error-telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("captureLlmErrorTelemetry", () => {
		it("should capture telemetry for a new error", () => {
			const error = new Error("Test error")
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
				inferenceProvider: "anthropic",
				inputTokens: 100,
				outputTokens: 50,
			}

			const result = captureLlmErrorTelemetry(options)

			expect(result).toBe(true)
			expect(TelemetryService.instance.captureLlmError).toHaveBeenCalledWith(
				"test-task-id",
				expect.objectContaining({
					inputTokens: 100,
					outputTokens: 50,
					errorType: "Error",
					errorMessage: "Test error",
				}),
			)
		})

		it("should mark the error as captured", () => {
			const error = new Error("Test error")
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			captureLlmErrorTelemetry(options)

			expect((error as any).__llmCompletionTelemetryCaptured).toBe(true)
		})

		it("should not capture telemetry for an already captured error", () => {
			const error = new Error("Test error")
			;(error as any).__llmCompletionTelemetryCaptured = true

			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			const result = captureLlmErrorTelemetry(options)

			expect(result).toBe(false)
			expect(TelemetryService.instance.captureLlmError).not.toHaveBeenCalled()
		})

		it("should use http status code in errorType when available", async () => {
			// Re-mock to return a status code
			const { getErrorStatusCode } = await import("@roo-code/types")
			vi.mocked(getErrorStatusCode).mockReturnValueOnce(429)

			const error = { status: 429, message: "Rate limited" }
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			captureLlmErrorTelemetry(options)

			expect(TelemetryService.instance.captureLlmError).toHaveBeenCalledWith(
				"test-task-id",
				expect.objectContaining({
					errorType: "http_429",
				}),
			)
		})

		it("should default token counts to 0 when not provided", () => {
			const error = new Error("Test error")
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			captureLlmErrorTelemetry(options)

			expect(TelemetryService.instance.captureLlmError).toHaveBeenCalledWith(
				"test-task-id",
				expect.objectContaining({
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}),
			)
		})

		it("should not capture telemetry when shouldReportApiErrorToTelemetry returns false", async () => {
			const { shouldReportApiErrorToTelemetry } = await import("@roo-code/types")
			vi.mocked(shouldReportApiErrorToTelemetry).mockReturnValueOnce(false)

			const error = new Error("User cancelled")
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			const result = captureLlmErrorTelemetry(options)

			expect(result).toBe(false)
			expect(TelemetryService.instance.captureLlmError).not.toHaveBeenCalled()
		})

		it("should handle non-Error objects", () => {
			const error = { code: "NETWORK_ERROR", message: "Connection failed" }
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			captureLlmErrorTelemetry(options)

			expect(TelemetryService.instance.captureLlmError).toHaveBeenCalledWith(
				"test-task-id",
				expect.objectContaining({
					errorType: "unknown",
					errorMessage: "Connection failed",
				}),
			)
			expect((error as any).__llmCompletionTelemetryCaptured).toBe(true)
		})

		it("should handle string errors", () => {
			const error = "Something went wrong"
			const options = {
				taskId: "test-task-id",
				error,
				apiRequestStartTime: performance.now() - 1000,
			}

			captureLlmErrorTelemetry(options)

			expect(TelemetryService.instance.captureLlmError).toHaveBeenCalledWith(
				"test-task-id",
				expect.objectContaining({
					errorType: "unknown",
					errorMessage: "Something went wrong",
				}),
			)
		})
	})

	describe("isLlmErrorTelemetryCaptured", () => {
		it("should return true for captured errors", () => {
			const error = new Error("Test")
			;(error as any).__llmCompletionTelemetryCaptured = true

			expect(isLlmErrorTelemetryCaptured(error)).toBe(true)
		})

		it("should return false for non-captured errors", () => {
			const error = new Error("Test")

			expect(isLlmErrorTelemetryCaptured(error)).toBe(false)
		})

		it("should return false for null", () => {
			expect(isLlmErrorTelemetryCaptured(null)).toBe(false)
		})

		it("should return false for undefined", () => {
			expect(isLlmErrorTelemetryCaptured(undefined)).toBe(false)
		})

		it("should return false for primitive values", () => {
			expect(isLlmErrorTelemetryCaptured("error")).toBe(false)
			expect(isLlmErrorTelemetryCaptured(123)).toBe(false)
		})

		it("should return false for objects without the flag", () => {
			const error = { message: "Test" }

			expect(isLlmErrorTelemetryCaptured(error)).toBe(false)
		})

		it("should return false when flag is explicitly false", () => {
			const error = { __llmCompletionTelemetryCaptured: false }

			expect(isLlmErrorTelemetryCaptured(error)).toBe(false)
		})
	})
})
