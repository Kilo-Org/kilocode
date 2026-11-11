import { describe, expect, test } from "bun:test"
import { ClientError } from "@opencode/client"
import { dict } from "../webview-ui/src/i18n/en"
import { failureText, readableMessage, toFailure } from "../webview-ui/src/v2/error"

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
  })
})
