// pnpm --filter @roo-code/types test src/__tests__/telemetry.test.ts

import {
	getErrorStatusCode,
	getErrorMessage,
	extractMessageFromJsonPayload,
	shouldReportApiErrorToTelemetry,
	EXPECTED_API_ERROR_CODES,
	ApiProviderError,
	isApiProviderError,
	extractApiProviderErrorProperties,
	ConsecutiveMistakeError,
	isConsecutiveMistakeError,
	extractConsecutiveMistakeErrorProperties,
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
		it("should return undefined for null, undefined, or objects without message", () => {
			expect(getErrorMessage(null)).toBeUndefined()
			expect(getErrorMessage(undefined)).toBeUndefined()
			expect(getErrorMessage({})).toBeUndefined()
			expect(getErrorMessage({ code: 500 })).toBeUndefined()
		})

		it("should return the primary message for simple OpenAI SDK errors", () => {
			const error = { status: 400, message: "Bad request" }
			expect(getErrorMessage(error)).toBe("Bad request")
		})

		it("should return message from plain objects with message property", () => {
			expect(getErrorMessage({ message: "error" })).toBe("error")
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

		it("should extract message from JSON payload in error message", () => {
			const error = {
				status: 503,
				message: '503 {"error":{"code":"","message":"Model unavailable"}}',
			}
			expect(getErrorMessage(error)).toBe("Model unavailable")
		})

		it("should extract message from JSON payload with status prefix", () => {
			const error = {
				status: 503,
				message:
					'503 {"error":{"code":"","message":"所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道，请更换分组尝试"}}',
			}
			expect(getErrorMessage(error)).toBe(
				"所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道，请更换分组尝试",
			)
		})

		it("should extract message from nested error.message containing JSON", () => {
			const error = {
				status: 500,
				message: "Request failed",
				error: { message: '{"error":{"message":"Upstream provider error"}}' },
			}
			expect(getErrorMessage(error)).toBe("Upstream provider error")
		})

		it("should return original message when JSON has no message field", () => {
			const error = {
				status: 500,
				message: '{"error":{"code":"123"}}',
			}
			expect(getErrorMessage(error)).toBe('{"error":{"code":"123"}}')
		})

		it("should return original message when JSON is invalid", () => {
			const error = {
				status: 500,
				message: "503 {invalid json}",
			}
			expect(getErrorMessage(error)).toBe("503 {invalid json}")
		})

		it("should extract message from standard Error object", () => {
			const error = new Error("Simple error message")
			expect(getErrorMessage(error)).toBe("Simple error message")
		})

		it("should extract message from standard Error with JSON payload", () => {
			const error = new Error('503 {"error":{"code":"","message":"Model unavailable"}}')
			expect(getErrorMessage(error)).toBe("Model unavailable")
		})

		it("should extract message from ApiProviderError", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			expect(getErrorMessage(error)).toBe("Test error")
		})

		it("should extract message from ApiProviderError with JSON payload", () => {
			const jsonMessage =
				'503 {"error":{"code":"","message":"所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道"}}'
			const error = new ApiProviderError(jsonMessage, "Anthropic", "claude-sonnet-4-5", "createMessage")
			expect(getErrorMessage(error)).toBe("所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道")
		})

		it("should handle ApiProviderError with errorCode but no status property", () => {
			const error = new ApiProviderError("Test error", "Anthropic", "claude-3-opus", "createMessage", 500)
			expect(getErrorMessage(error)).toBe("Test error")
		})
	})

	describe("extractMessageFromJsonPayload", () => {
		it("should return undefined for messages without JSON", () => {
			expect(extractMessageFromJsonPayload("Simple error message")).toBeUndefined()
			expect(extractMessageFromJsonPayload("Error: something went wrong")).toBeUndefined()
			expect(extractMessageFromJsonPayload("")).toBeUndefined()
		})

		it("should extract message from error.message structure", () => {
			const json = '{"error":{"message":"Model unavailable"}}'
			expect(extractMessageFromJsonPayload(json)).toBe("Model unavailable")
		})

		it("should extract message from error.message with code structure", () => {
			const json = '{"error":{"code":"","message":"Model unavailable"}}'
			expect(extractMessageFromJsonPayload(json)).toBe("Model unavailable")
		})

		it("should extract message from status prefix followed by JSON", () => {
			const message = '503 {"error":{"code":"","message":"Model unavailable"}}'
			expect(extractMessageFromJsonPayload(message)).toBe("Model unavailable")
		})

		it("should extract message from simple message structure", () => {
			const json = '{"message":"Simple error"}'
			expect(extractMessageFromJsonPayload(json)).toBe("Simple error")
		})

		it("should return undefined for JSON without message field", () => {
			const json = '{"error":{"code":"500"}}'
			expect(extractMessageFromJsonPayload(json)).toBeUndefined()
		})

		it("should return undefined for invalid JSON", () => {
			expect(extractMessageFromJsonPayload("{invalid json}")).toBeUndefined()
			expect(extractMessageFromJsonPayload("503 {not: valid: json}")).toBeUndefined()
		})

		it("should handle nested error structure with empty code", () => {
			const json = '{"error":{"code":"","message":"Token quota exceeded"}}'
			expect(extractMessageFromJsonPayload(json)).toBe("Token quota exceeded")
		})

		it("should handle Unicode messages correctly", () => {
			const json = '{"error":{"message":"所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道"}}'
			expect(extractMessageFromJsonPayload(json)).toBe(
				"所有令牌分组 Tier 3 下对于模型 claude-sonnet-4-5 均无可用渠道",
			)
		})

		it("should return undefined when message field is not a string", () => {
			const json = '{"error":{"message":123}}'
			expect(extractMessageFromJsonPayload(json)).toBeUndefined()
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

	describe("ConsecutiveMistakeError", () => {
		it("should create an error with correct properties", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 5, 3, "no_tools_used")

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ConsecutiveMistakeError")
			expect(error.taskId).toBe("task-123")
			expect(error.consecutiveMistakeCount).toBe(5)
			expect(error.consecutiveMistakeLimit).toBe(3)
			expect(error.reason).toBe("no_tools_used")
		})

		it("should create an error with provider and modelId", () => {
			const error = new ConsecutiveMistakeError(
				"Test error",
				"task-123",
				5,
				3,
				"no_tools_used",
				"anthropic",
				"claude-3-sonnet-20240229",
			)

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ConsecutiveMistakeError")
			expect(error.taskId).toBe("task-123")
			expect(error.consecutiveMistakeCount).toBe(5)
			expect(error.consecutiveMistakeLimit).toBe(3)
			expect(error.reason).toBe("no_tools_used")
			expect(error.provider).toBe("anthropic")
			expect(error.modelId).toBe("claude-3-sonnet-20240229")
		})

		it("should be an instance of Error", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3)
			expect(error).toBeInstanceOf(Error)
		})

		it("should handle zero values", () => {
			const error = new ConsecutiveMistakeError("Zero test", "task-000", 0, 0)

			expect(error.taskId).toBe("task-000")
			expect(error.consecutiveMistakeCount).toBe(0)
			expect(error.consecutiveMistakeLimit).toBe(0)
		})

		it("should default reason to unknown when not provided", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3)
			expect(error.reason).toBe("unknown")
		})

		it("should accept tool_repetition reason", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "tool_repetition")
			expect(error.reason).toBe("tool_repetition")
		})

		it("should accept no_tools_used reason", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "no_tools_used")
			expect(error.reason).toBe("no_tools_used")
		})

		it("should have undefined provider and modelId when not provided", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "no_tools_used")
			expect(error.provider).toBeUndefined()
			expect(error.modelId).toBeUndefined()
		})
	})

	describe("isConsecutiveMistakeError", () => {
		it("should return true for ConsecutiveMistakeError instances", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3)
			expect(isConsecutiveMistakeError(error)).toBe(true)
		})

		it("should return false for regular Error instances", () => {
			const error = new Error("Test error")
			expect(isConsecutiveMistakeError(error)).toBe(false)
		})

		it("should return false for ApiProviderError instances", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			expect(isConsecutiveMistakeError(error)).toBe(false)
		})

		it("should return false for null and undefined", () => {
			expect(isConsecutiveMistakeError(null)).toBe(false)
			expect(isConsecutiveMistakeError(undefined)).toBe(false)
		})

		it("should return false for non-error objects", () => {
			expect(isConsecutiveMistakeError({})).toBe(false)
			expect(
				isConsecutiveMistakeError({
					taskId: "task-123",
					consecutiveMistakeCount: 3,
					consecutiveMistakeLimit: 3,
				}),
			).toBe(false)
		})

		it("should return false for Error with wrong name", () => {
			const error = new Error("Test error")
			error.name = "CustomError"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).taskId = "task-123"
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).consecutiveMistakeCount = 3
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(error as any).consecutiveMistakeLimit = 3
			expect(isConsecutiveMistakeError(error)).toBe(false)
		})
	})

	describe("extractConsecutiveMistakeErrorProperties", () => {
		it("should extract all properties from ConsecutiveMistakeError", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 5, 3, "no_tools_used")
			const properties = extractConsecutiveMistakeErrorProperties(error)

			expect(properties).toEqual({
				taskId: "task-123",
				consecutiveMistakeCount: 5,
				consecutiveMistakeLimit: 3,
				reason: "no_tools_used",
			})
		})

		it("should extract all properties including provider and modelId", () => {
			const error = new ConsecutiveMistakeError(
				"Test error",
				"task-123",
				5,
				3,
				"no_tools_used",
				"anthropic",
				"claude-3-sonnet-20240229",
			)
			const properties = extractConsecutiveMistakeErrorProperties(error)

			expect(properties).toEqual({
				taskId: "task-123",
				consecutiveMistakeCount: 5,
				consecutiveMistakeLimit: 3,
				reason: "no_tools_used",
				provider: "anthropic",
				modelId: "claude-3-sonnet-20240229",
			})
		})

		it("should not include provider and modelId when undefined", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 5, 3, "no_tools_used")
			const properties = extractConsecutiveMistakeErrorProperties(error)

			expect(properties).not.toHaveProperty("provider")
			expect(properties).not.toHaveProperty("modelId")
		})

		it("should handle zero values correctly", () => {
			const error = new ConsecutiveMistakeError("Zero test", "task-000", 0, 0)
			const properties = extractConsecutiveMistakeErrorProperties(error)

			expect(properties).toEqual({
				taskId: "task-000",
				consecutiveMistakeCount: 0,
				consecutiveMistakeLimit: 0,
				reason: "unknown",
			})
		})

		it("should handle large numbers", () => {
			const error = new ConsecutiveMistakeError("Large test", "task-large", 1000, 500, "tool_repetition")
			const properties = extractConsecutiveMistakeErrorProperties(error)

			expect(properties).toEqual({
				taskId: "task-large",
				consecutiveMistakeCount: 1000,
				consecutiveMistakeLimit: 500,
				reason: "tool_repetition",
			})
		})
	})
})
