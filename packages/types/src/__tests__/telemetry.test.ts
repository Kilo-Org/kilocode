// pnpm --filter @roo-code/types test src/__tests__/telemetry.test.ts

import {
	getErrorStatusCode,
	getErrorMessage,
	shouldReportApiErrorToTelemetry,
	EXPECTED_API_ERROR_CODES,
	ApiProviderError,
	isApiProviderError,
	extractApiProviderErrorProperties,
} from "../telemetry.js"

describe("telemetry error utilities", () => {
	describe("getErrorStatusCode", () => {
		it("should return undefined for non-object errors", () => {
			expect(getErrorStatusCode(null)).toBeUndefined()
			expect(getErrorStatusCode(undefined)).toBeUndefined()
			expect(getErrorStatusCode("error string")).toBeUndefined()
			expect(getErrorStatusCode(42)).toBeUndefined()
		})

		it("should return undefined for objects without status property", () => {
			expect(getErrorStatusCode({})).toBeUndefined()
			expect(getErrorStatusCode({ message: "error" })).toBeUndefined()
			expect(getErrorStatusCode({ code: 500 })).toBeUndefined()
		})

		it("should return undefined for objects with non-numeric status", () => {
			expect(getErrorStatusCode({ status: "500" })).toBeUndefined()
			expect(getErrorStatusCode({ status: null })).toBeUndefined()
			expect(getErrorStatusCode({ status: undefined })).toBeUndefined()
		})

		it("should return status for OpenAI SDK-like errors", () => {
			const error = { status: 429, message: "Rate limit exceeded" }
			expect(getErrorStatusCode(error)).toBe(429)
		})

		it("should return status for errors with additional properties", () => {
			const error = {
				status: 500,
				code: "internal_error",
				message: "Internal server error",
				error: { message: "Upstream error" },
			}
			expect(getErrorStatusCode(error)).toBe(500)
		})
	})

	describe("getErrorMessage", () => {
		it("should return undefined for non-OpenAI SDK errors", () => {
			expect(getErrorMessage(null)).toBeUndefined()
			expect(getErrorMessage(undefined)).toBeUndefined()
			expect(getErrorMessage({ message: "error" })).toBeUndefined()
		})

		it("should return the primary message for simple OpenAI SDK errors", () => {
			const error = { status: 400, message: "Bad request" }
			expect(getErrorMessage(error)).toBe("Bad request")
		})

		it("should prioritize nested error.message over primary message", () => {
			const error = {
				status: 500,
				message: "Request failed",
				error: { message: "Upstream provider error" },
			}
			expect(getErrorMessage(error)).toBe("Upstream provider error")
		})

		it("should prioritize metadata.raw over other messages", () => {
			const error = {
				status: 429,
				message: "Request failed",
				error: {
					message: "Error details",
					metadata: { raw: "Rate limit exceeded: free-models-per-day" },
				},
			}
			expect(getErrorMessage(error)).toBe("Rate limit exceeded: free-models-per-day")
		})

		it("should fallback to nested error.message when metadata.raw is undefined", () => {
			const error = {
				status: 400,
				message: "Request failed",
				error: {
					message: "Detailed error message",
					metadata: {},
				},
			}
			expect(getErrorMessage(error)).toBe("Detailed error message")
		})

		it("should fallback to primary message when no nested messages exist", () => {
			const error = {
				status: 403,
				message: "Forbidden",
				error: {},
			}
			expect(getErrorMessage(error)).toBe("Forbidden")
		})
	})

	describe("shouldReportApiErrorToTelemetry", () => {
		it("should return false for expected error codes", () => {
			for (const code of EXPECTED_API_ERROR_CODES) {
				expect(shouldReportApiErrorToTelemetry(code)).toBe(false)
			}
		})

		it("should return false for 402 billing errors", () => {
			expect(shouldReportApiErrorToTelemetry(402)).toBe(false)
			expect(shouldReportApiErrorToTelemetry(402, "Payment required")).toBe(false)
		})

		it("should return false for 429 rate limit errors", () => {
			expect(shouldReportApiErrorToTelemetry(429)).toBe(false)
			expect(shouldReportApiErrorToTelemetry(429, "Rate limit exceeded")).toBe(false)
		})

		it("should return false for messages starting with 429", () => {
			expect(shouldReportApiErrorToTelemetry(undefined, "429 Rate limit exceeded")).toBe(false)
			expect(shouldReportApiErrorToTelemetry(undefined, "429: Too many requests")).toBe(false)
		})

		it("should return false for messages containing 'rate limit' (case insensitive)", () => {
			expect(shouldReportApiErrorToTelemetry(undefined, "Rate limit exceeded")).toBe(false)
			expect(shouldReportApiErrorToTelemetry(undefined, "RATE LIMIT error")).toBe(false)
			expect(shouldReportApiErrorToTelemetry(undefined, "Request failed due to rate limit")).toBe(false)
		})

		it("should return true for non-rate-limit errors", () => {
			expect(shouldReportApiErrorToTelemetry(500)).toBe(true)
			expect(shouldReportApiErrorToTelemetry(400, "Bad request")).toBe(true)
			expect(shouldReportApiErrorToTelemetry(401, "Unauthorized")).toBe(true)
		})

		it("should return true when no error code or message is provided", () => {
			expect(shouldReportApiErrorToTelemetry()).toBe(true)
			expect(shouldReportApiErrorToTelemetry(undefined, undefined)).toBe(true)
		})

		it("should return true for regular error messages without rate limit keywords", () => {
			expect(shouldReportApiErrorToTelemetry(undefined, "Internal server error")).toBe(true)
			expect(shouldReportApiErrorToTelemetry(undefined, "Connection timeout")).toBe(true)
		})
	})

	describe("EXPECTED_API_ERROR_CODES", () => {
		it("should contain 402 (payment required)", () => {
			expect(EXPECTED_API_ERROR_CODES.has(402)).toBe(true)
		})

		it("should contain 429 (rate limit)", () => {
			expect(EXPECTED_API_ERROR_CODES.has(429)).toBe(true)
		})
	})

	describe("ApiProviderError", () => {
		it("should create an error with correct properties", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 500)

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ApiProviderError")
			expect(error.provider).toBe("OpenRouter")
			expect(error.modelId).toBe("gpt-4")
			expect(error.operation).toBe("createMessage")
			expect(error.errorCode).toBe(500)
		})

		it("should work without optional errorCode", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")

			expect(error.message).toBe("Test error")
			expect(error.provider).toBe("OpenRouter")
			expect(error.modelId).toBe("gpt-4")
			expect(error.operation).toBe("createMessage")
			expect(error.errorCode).toBeUndefined()
		})

		it("should be an instance of Error", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			expect(error).toBeInstanceOf(Error)
		})
	})

	describe("isApiProviderError", () => {
		it("should return true for ApiProviderError instances", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			expect(isApiProviderError(error)).toBe(true)
		})

		it("should return true for ApiProviderError with errorCode", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 429)
			expect(isApiProviderError(error)).toBe(true)
		})

		it("should return false for regular Error instances", () => {
			const error = new Error("Test error")
			expect(isApiProviderError(error)).toBe(false)
		})

		it("should return false for null and undefined", () => {
			expect(isApiProviderError(null)).toBe(false)
			expect(isApiProviderError(undefined)).toBe(false)
		})

		it("should return false for non-error objects", () => {
			expect(isApiProviderError({})).toBe(false)
			expect(isApiProviderError({ provider: "test", modelId: "test", operation: "test" })).toBe(false)
		})

		it("should return false for Error with wrong name", () => {
			const error = new Error("Test error")
			error.name = "CustomError"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).provider = "OpenRouter"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).modelId = "gpt-4"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).operation = "createMessage"
			expect(isApiProviderError(error)).toBe(false)
		})
	})

	describe("extractApiProviderErrorProperties", () => {
		it("should extract all properties from ApiProviderError", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 500)
			const properties = extractApiProviderErrorProperties(error)

			expect(properties).toEqual({
				provider: "OpenRouter",
				modelId: "gpt-4",
				operation: "createMessage",
				errorCode: 500,
			})
		})

		it("should not include errorCode when undefined", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			const properties = extractApiProviderErrorProperties(error)

			expect(properties).toEqual({
				provider: "OpenRouter",
				modelId: "gpt-4",
				operation: "createMessage",
			})
			expect(properties).not.toHaveProperty("errorCode")
		})

		it("should include errorCode when it is 0", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 0)
			const properties = extractApiProviderErrorProperties(error)

			// errorCode of 0 is falsy but !== undefined, so it should be included
			expect(properties).toHaveProperty("errorCode", 0)
		})
	})
})
