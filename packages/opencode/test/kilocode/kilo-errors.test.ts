import { describe, it, expect } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import {
  isKiloError,
  kiloErrorDescription,
  kiloErrorLine,
  kiloErrorTitle,
  parseKiloErrorCode,
} from "../../src/kilocode/kilo-errors"
import { SessionRetry } from "../../src/session/retry"
import { NamedError } from "@opencode-ai/core/util/error"

// The body the Kilo Gateway answers a rejected credential with.
const SIGNED_OUT = JSON.stringify({
  error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." },
  error_type: "authentication_required",
})

/**
 * Helper to create a mock APIError object (as returned by .toObject())
 */
function makeAPIError(opts: {
  statusCode?: number
  isRetryable?: boolean
  responseBody?: string
  message?: string
}): ReturnType<NamedError["toObject"]> {
  return new MessageV2.APIError({
    message: opts.message ?? "Error",
    statusCode: opts.statusCode,
    isRetryable: opts.isRetryable ?? false,
    responseBody: opts.responseBody,
  }).toObject()
}

describe("parseKiloErrorCode", () => {
  it("extracts PAID_MODEL_AUTH_REQUIRED from { error: { code } }", () => {
    const error = makeAPIError({
      statusCode: 401,
      responseBody: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }),
    })
    expect(parseKiloErrorCode(error)).toBe("PAID_MODEL_AUTH_REQUIRED")
  })

  it("extracts PROMOTION_MODEL_LIMIT_REACHED from { code } (top-level)", () => {
    const error = makeAPIError({
      statusCode: 429,
      responseBody: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }),
    })
    expect(parseKiloErrorCode(error)).toBe("PROMOTION_MODEL_LIMIT_REACHED")
  })

  it("extracts PROMOTION_MODEL_LIMIT_REACHED from { error: { code } }", () => {
    const error = makeAPIError({
      statusCode: 401,
      responseBody: JSON.stringify({
        error: {
          code: "PROMOTION_MODEL_LIMIT_REACHED",
          message: "Sign up for free to continue",
        },
      }),
    })
    expect(parseKiloErrorCode(error)).toBe("PROMOTION_MODEL_LIMIT_REACHED")
  })

  it("extracts INVALID_TOKEN from the gateway's rejected-credential response", () => {
    const error = makeAPIError({ statusCode: 401, responseBody: SIGNED_OUT })
    expect(parseKiloErrorCode(error)).toBe("INVALID_TOKEN")
  })

  it("ignores INVALID_TOKEN on a status other than 401", () => {
    const error = makeAPIError({ statusCode: 400, responseBody: SIGNED_OUT })
    expect(parseKiloErrorCode(error)).toBeUndefined()
  })

  it("returns undefined for non-Kilo error codes", () => {
    const error = makeAPIError({
      statusCode: 429,
      responseBody: JSON.stringify({ error: { code: "SOME_OTHER_ERROR" } }),
    })
    expect(parseKiloErrorCode(error)).toBeUndefined()
  })

  it("returns undefined for non-APIError types", () => {
    const error = new MessageV2.AbortedError({ message: "aborted" }).toObject()
    expect(parseKiloErrorCode(error)).toBeUndefined()
  })

  it("returns undefined for malformed responseBody", () => {
    const error = makeAPIError({
      statusCode: 401,
      responseBody: "not valid json",
    })
    expect(parseKiloErrorCode(error)).toBeUndefined()
  })

  it("returns undefined when responseBody is missing", () => {
    const error = makeAPIError({
      statusCode: 401,
    })
    expect(parseKiloErrorCode(error)).toBeUndefined()
  })
})

describe("signed-out copy", () => {
  it("tells the user they were signed out and to sign in again", () => {
    expect(kiloErrorTitle("INVALID_TOKEN")).toBe("You've been signed out of Kilo")
    expect(kiloErrorDescription("INVALID_TOKEN")).toContain("Sign in again")
  })

  it("gives `kilo run` a one-line message that names the login command", () => {
    const error = makeAPIError({ statusCode: 401, responseBody: SIGNED_OUT })
    expect(kiloErrorLine(error)).toBe(
      "You've been signed out of Kilo. Run `kilo auth login` to connect to Kilo Gateway.",
    )
  })

  it("leaves errors without a Kilo code to the caller", () => {
    expect(kiloErrorLine(makeAPIError({ statusCode: 500, message: "boom" }))).toBeUndefined()
  })
})

describe("isKiloError", () => {
  it("returns true for PAID_MODEL_AUTH_REQUIRED", () => {
    const error = makeAPIError({
      statusCode: 401,
      responseBody: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }),
    })
    expect(isKiloError(error)).toBe(true)
  })

  it("returns true for PROMOTION_MODEL_LIMIT_REACHED", () => {
    const error = makeAPIError({
      statusCode: 429,
      responseBody: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }),
    })
    expect(isKiloError(error)).toBe(true)
  })

  it("returns false for regular 429 errors without Kilo code", () => {
    const error = makeAPIError({
      statusCode: 429,
      isRetryable: true,
      message: "Too Many Requests",
    })
    expect(isKiloError(error)).toBe(false)
  })

  it("returns false for non-APIError types", () => {
    const error = new MessageV2.AbortedError({ message: "aborted" }).toObject()
    expect(isKiloError(error)).toBe(false)
  })
})

describe("SessionRetry.retryable with Kilo errors", () => {
  it("returns undefined for PAID_MODEL_AUTH_REQUIRED (not retryable)", () => {
    const error = makeAPIError({
      statusCode: 401,
      isRetryable: false,
      responseBody: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }),
    })
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  it("returns undefined for PROMOTION_MODEL_LIMIT_REACHED even when isRetryable is true", () => {
    const error = makeAPIError({
      statusCode: 429,
      isRetryable: true,
      responseBody: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }),
    })
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  it("returns undefined for INVALID_TOKEN (retrying a rejected credential cannot succeed)", () => {
    const error = makeAPIError({ statusCode: 401, isRetryable: false, responseBody: SIGNED_OUT })
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  it("still returns retry details for regular 429 errors", () => {
    const error = makeAPIError({
      statusCode: 429,
      isRetryable: true,
      message: "Too Many Requests",
    })
    expect(SessionRetry.retryable(error)).toEqual({ message: "Too Many Requests" })
  })
})
