import { describe, expect, it } from "bun:test"
import { authFailure, needsAuthNames, normalize } from "../../src/services/mcp-auth/status"

describe("authFailure", () => {
  it("recognizes recoverable sign-in failures", () => {
    const cases = [
      "Unauthorized: authentication required",
      "Browser authorization failed: Authorization cancelled",
      "Browser authorization was rejected: replaced by another authorization attempt",
      "Token exchange failed: invalid client",
      "Error POSTing to endpoint (HTTP 401): missing bearer token",
      "Error POSTing to endpoint (HTTP 403): Forbidden",
      "SSE error: Non-200 status code (403)",
      "SSE error: Non-200 status code (401)",
      "OAuth discovery failed",
      "token refresh returned invalid_grant",
      "token refresh returned invalid_token",
    ]
    for (const message of cases) expect(authFailure(message)).toBe(true)
  })

  it("leaves unrelated failures as failed", () => {
    const cases = [
      "Connection refused",
      "Connection closed",
      "Failed to get tools",
      "spawn npx ENOENT",
      'Invalid MCP URL for "broken"',
      "Error POSTing to endpoint (HTTP 500)",
      "SSE error: Non-200 status code (404)",
      "(500)",
    ]
    for (const message of cases) expect(authFailure(message)).toBe(false)
  })

  it("does not false-positive on numbers or hostnames that resemble auth markers", () => {
    const cases = [
      "connect ECONNREFUSED 127.0.0.1:40123",
      "connect ECONNREFUSED 127.0.0.1:40323",
      'Invalid MCP URL for "broken401"',
      'Invalid MCP URL for "broken403"',
      'Invalid MCP URL for "oauthserver"',
      "Failed to connect to myoauthapp.internal",
      "Request failed after 403 ms",
    ]
    for (const message of cases) expect(authFailure(message)).toBe(false)
  })

  it("returns false for an absent error", () => {
    expect(authFailure(undefined)).toBe(false)
  })
})

describe("normalize", () => {
  it("rewrites recoverable failed entries to needs_auth and preserves the error", () => {
    const result = normalize({
      anaconda: { status: "failed", error: "SSE error: Non-200 status code (403)" },
    })
    expect(result.anaconda).toEqual({ status: "needs_auth" })
  })

  it("leaves unrelated failures untouched", () => {
    const result = normalize({
      broken: { status: "failed", error: "Connection refused" },
    })
    expect(result.broken).toEqual({ status: "failed", error: "Connection refused" })
  })

  it("passes through non-failed statuses unchanged", () => {
    const input = {
      a: { status: "connected" as const },
      b: { status: "disabled" as const },
      c: { status: "needs_auth" as const },
      d: { status: "needs_client_registration" as const, error: "no client" },
    }
    expect(normalize(input)).toEqual(input)
  })
})

describe("needsAuthNames", () => {
  it("returns only needs_auth servers, sorted", () => {
    const names = needsAuthNames({
      zebra: { status: "needs_auth" },
      anaconda: { status: "failed", error: "Unauthorized: authentication required" },
      connected: { status: "connected" },
      disabled: { status: "disabled" },
    })
    expect(names).toEqual(["anaconda", "zebra"])
  })

  it("returns an empty array when nothing needs auth", () => {
    expect(needsAuthNames({ ok: { status: "connected" } })).toEqual([])
  })
})
