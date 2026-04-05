import { describe, it, expect } from "bun:test"
import type { AssistantMessage } from "@kilocode/sdk/v2"
import {
  unwrapError,
  parseAssistantError,
  isUnauthorizedPaidModelError,
  isUnauthorizedPromotionLimitError,
} from "../../webview-ui/src/utils/errorUtils"

type AssistantError = AssistantMessage["error"]

describe("unwrapError", () => {
  it("returns plain string messages unchanged", () => {
    expect(unwrapError("something went wrong")).toBe("something went wrong")
  })

  it("extracts message from JSON error object with error.message", () => {
    const input = JSON.stringify({ error: { message: "rate limit exceeded" } })
    expect(unwrapError(input)).toBe("rate limit exceeded")
  })

  it("returns original message for malformed JSON", () => {
    expect(unwrapError("{not valid json")).toBe("{not valid json")
  })

  it("strips leading 'Error: ' prefix before parsing", () => {
    const json = JSON.stringify({ message: "connection refused" })
    expect(unwrapError(`Error: ${json}`)).toBe("connection refused")
  })
})

describe("parseAssistantError", () => {
  it("returns null for null input", () => {
    expect(parseAssistantError(null)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(parseAssistantError(undefined)).toBeNull()
  })

  it("returns null for non-APIError (e.g. MessageAbortedError)", () => {
    const error: AssistantError = { name: "MessageAbortedError", data: { message: "aborted" } }
    expect(parseAssistantError(error)).toBeNull()
  })

  it("returns null when APIError has no data", () => {
    // Simulate a malformed error where data is missing at runtime
    const error = { name: "APIError" } as unknown as AssistantError
    expect(parseAssistantError(error)).toBeNull()
  })

  it("extracts statusCode and message from APIError data", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 401, message: "Unauthorized", isRetryable: false },
    }
    const result = parseAssistantError(error)
    expect(result).toEqual({ statusCode: 401, code: undefined, message: "Unauthorized" })
  })

  it("extracts code from responseBody JSON with error.code", () => {
    const responseBody = JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } })
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 401, message: "Unauthorized", isRetryable: false, responseBody },
    }
    const result = parseAssistantError(error)
    expect(result).toEqual({ statusCode: 401, code: "PAID_MODEL_AUTH_REQUIRED", message: "Unauthorized" })
  })

  it("extracts code from responseBody JSON with top-level code", () => {
    const responseBody = JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" })
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 429, message: "Too Many Requests", isRetryable: false, responseBody },
    }
    const result = parseAssistantError(error)
    expect(result).toEqual({ statusCode: 429, code: "PROMOTION_MODEL_LIMIT_REACHED", message: "Too Many Requests" })
  })

  it("handles invalid responseBody JSON gracefully", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 500, message: "Server Error", isRetryable: false, responseBody: "not json" },
    }
    const result = parseAssistantError(error)
    expect(result).toEqual({ statusCode: 500, code: undefined, message: "Server Error" })
  })

  it("handles missing responseBody", () => {
    const error: AssistantError = {
      name: "APIError",
      data: { statusCode: 403, message: "Forbidden", isRetryable: false },
    }
    const result = parseAssistantError(error)
    expect(result).toEqual({ statusCode: 403, code: undefined, message: "Forbidden" })
  })
})

describe("isUnauthorizedPaidModelError", () => {
  it("returns true for 401 + PAID_MODEL_AUTH_REQUIRED", () => {
    expect(isUnauthorizedPaidModelError({ statusCode: 401, code: "PAID_MODEL_AUTH_REQUIRED" })).toBe(true)
  })

  it("returns false for 401 + different code", () => {
    expect(isUnauthorizedPaidModelError({ statusCode: 401, code: "SOMETHING_ELSE" })).toBe(false)
  })

  it("returns false for null input", () => {
    expect(isUnauthorizedPaidModelError(null)).toBe(false)
  })
})

describe("isUnauthorizedPromotionLimitError", () => {
  it("returns true for 401 + PROMOTION_MODEL_LIMIT_REACHED", () => {
    expect(isUnauthorizedPromotionLimitError({ statusCode: 401, code: "PROMOTION_MODEL_LIMIT_REACHED" })).toBe(true)
  })

  it("returns true for 429 + PROMOTION_MODEL_LIMIT_REACHED", () => {
    expect(isUnauthorizedPromotionLimitError({ statusCode: 429, code: "PROMOTION_MODEL_LIMIT_REACHED" })).toBe(true)
  })

  it("returns false for null input", () => {
    expect(isUnauthorizedPromotionLimitError(null)).toBe(false)
  })
})
