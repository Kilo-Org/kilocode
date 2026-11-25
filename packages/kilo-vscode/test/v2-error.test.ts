import { describe, expect, test } from "bun:test"
import { ClientError } from "@opencode/client"
import { dict } from "../webview-ui/src/i18n/en"
import { failureText, isAuthSessionError, isSignedOutError, readableMessage, toFailure } from "../webview-ui/src/v2/error"

const t = (key: string, params?: Record<string, string | number | boolean>) =>
  (dict as Record<string, string>)[key]?.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? "")) ??
  key

describe("chat error text", () => {
  test("names a timed-out server instead of the transport reason", () => {
    const failure = toFailure(new ClientError("UnexpectedStatus", { cause: { status: 408 }, detail: "408" }))
    expect(failure.message).toBe("The Kilo server took too long to respond. Try again.")
    expect(failure.details).toContain("UnexpectedStatus: 408")
  })

  test("keeps an unrecognized status readable and specific", () => {
    const failure = toFailure(new ClientError("UnexpectedStatus", { cause: { status: 404 }, detail: "404" }))
    expect(failure.message).toBe("The Kilo server returned an unexpected status (404).")
  })

  test("explains a lost connection and keeps the cause in the details", () => {
    const failure = toFailure(new ClientError("Transport", { cause: new Error("fetch failed") }))
    expect(failure.message).toBe("Couldn't reach the Kilo server. Check that it is running, then try again.")
    expect(failure.details).toContain("fetch failed")
  })

  test("explains a malformed stream response", () => {
    expect(readableMessage(new ClientError("MalformedResponse"))).toBe(
      "The Kilo server sent a response this client couldn't read.",
    )
  })

  test("unwraps a serialized provider rejection", () => {
    const body = JSON.stringify({ type: "error", error: { type: "api_error", message: "Provider rejected the key" } })
    expect(readableMessage(`Request failed: ${body}`)).toBe("api_error: Provider rejected the key")
  })

  test("reads the message out of the shapes reported to the chat", () => {
    expect(readableMessage({ message: "Permission denied" })).toBe("Permission denied")
    expect(readableMessage({ error: { message: "Model unavailable" } })).toBe("Model unavailable")
    expect(readableMessage({ data: { message: "Bad request" } })).toBe("Bad request")
    expect(readableMessage("plain text")).toBe("plain text")
  })

  test("rewrites a stored session error that repeats a client reason", () => {
    expect(readableMessage({ type: "unknown", message: "UnexpectedStatus: 408" })).toBe(
      "The Kilo server took too long to respond. Try again.",
    )
  })

  test("never renders a blank alert", () => {
    expect(toFailure("")).toEqual({ key: "error.failure.unknown", message: "unknown error" })
    expect(toFailure("   ").message).toBe("unknown error")
    expect(toFailure(undefined).message).toBe("unknown error")
  })

  test("resolves a known reason through the locale and passes a server message through", () => {
    const timeout = toFailure(new ClientError("UnexpectedStatus", { cause: { status: 408 }, detail: "408" }))
    expect(failureText(timeout, t)).toBe("The Kilo server took too long to respond. Try again.")
    expect(failureText(toFailure({ message: "Permission denied" }), t)).toBe("Permission denied")
    expect(failureText(toFailure(new ClientError("UnexpectedStatus", { cause: { status: 418 } })), t)).toBe(
      "The Kilo server returned an unexpected status (418).",
    )
  })

  test("keeps the stack as details for an uncaught error", () => {
    const failure = toFailure(new Error("boom"))
    expect(failure.message).toBe("boom")
    expect(failure.details).toContain("Error: boom")
    expect(failure.auth).toBeUndefined()
  })

  test("marks auth failures without tagging unrelated errors", () => {
    expect(toFailure(new ClientError("UnexpectedStatus", { cause: { status: 401 }, detail: "401" })).auth).toBe(true)
    expect(toFailure({ type: "provider.auth", message: "Invalid API key" }).auth).toBe(true)
    expect(toFailure({ type: "unauthorized", message: "Not signed in to Kilo Gateway" }).auth).toBe(true)
    expect(toFailure({ status: 401, message: "Unauthorized" }).auth).toBe(true)
    expect(toFailure({ error: { type: "provider.auth", message: "Expired" } }).auth).toBe(true)

    const authErr = new Error("Expired token")
    authErr.name = "AuthorizationError"
    expect(toFailure(authErr).auth).toBe(true)

    expect(toFailure(new ClientError("UnexpectedStatus", { cause: { status: 408 }, detail: "408" })).auth).toBeUndefined()
    expect(toFailure(new ClientError("UnexpectedStatus", { cause: { status: 500 }, detail: "500" })).auth).toBeUndefined()
    expect(toFailure({ type: "provider.rate-limit", status: 429, message: "Slow down" }).auth).toBeUndefined()
  })
})

describe("isAuthSessionError", () => {
  test("detects provider.auth and HTTP 401 session errors", () => {
    expect(isAuthSessionError({ type: "provider.auth" })).toBe(true)
    expect(isAuthSessionError({ type: "provider.auth", status: 403 })).toBe(true)
    expect(isAuthSessionError({ type: "provider.auth", status: 401 })).toBe(true)
    expect(isAuthSessionError({ type: "provider.authentication", status: 401 })).toBe(true)
    expect(isAuthSessionError({ type: "unknown", status: 401 })).toBe(true)
    expect(isAuthSessionError({ status: 401 })).toBe(true)
  })

  test("ignores non-auth session errors", () => {
    expect(isAuthSessionError({ type: "provider.rate-limit", status: 429 })).toBe(false)
    expect(isAuthSessionError({ type: "provider.quota", status: 402 })).toBe(false)
    expect(isAuthSessionError({ type: "provider.no-route" })).toBe(false)
    expect(isAuthSessionError({ type: "provider.transport" })).toBe(false)
    expect(isAuthSessionError({ type: "aborted" })).toBe(false)
    expect(isAuthSessionError({})).toBe(false)
  })
})

describe("isSignedOutError", () => {
  const rejected = JSON.stringify({
    error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." },
    error_type: "authentication_required",
  })

  test("recognizes INVALID_TOKEN on HTTP 401 (nested and top-level)", () => {
    expect(
      isSignedOutError({ type: "provider.auth", message: "Unauthorized", status: 401, response: { body: rejected } }),
    ).toBe(true)
    expect(
      isSignedOutError({
        type: "provider.auth",
        message: "Unauthorized",
        status: 401,
        response: { body: JSON.stringify({ code: "INVALID_TOKEN" }) },
      }),
    ).toBe(true)
  })

  test("returns false for INVALID_TOKEN on a status other than 401 or without status", () => {
    expect(isSignedOutError({ type: "provider.invalid-request", message: "Bad", status: 400, response: { body: rejected } })).toBe(
      false,
    )
    expect(isSignedOutError({ type: "provider.auth", message: "Forbidden", status: 403, response: { body: rejected } })).toBe(
      false,
    )
    expect(isSignedOutError({ type: "provider.auth", message: "No status", response: { body: rejected } })).toBe(false)
  })

  test("returns false for PAID_MODEL_AUTH_REQUIRED and PROMOTION_MODEL_LIMIT_REACHED", () => {
    expect(
      isSignedOutError({
        type: "provider.auth",
        message: "Sign in",
        status: 401,
        response: { body: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }) },
      }),
    ).toBe(false)
    expect(
      isSignedOutError({
        type: "provider.auth",
        message: "Sign up",
        status: 401,
        response: { body: JSON.stringify({ error: { code: "PROMOTION_MODEL_LIMIT_REACHED" } }) },
      }),
    ).toBe(false)
  })

  test("returns false for null, undefined, plain messages, and malformed response bodies", () => {
    expect(isSignedOutError(null)).toBe(false)
    expect(isSignedOutError(undefined)).toBe(false)
    expect(isSignedOutError({ message: "boom" })).toBe(false)
    expect(isSignedOutError({ type: "provider.auth", message: "Bad", status: 401, response: { body: "not json {" } })).toBe(
      false,
    )
  })
})
