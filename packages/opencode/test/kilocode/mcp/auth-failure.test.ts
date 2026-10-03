import { describe, expect, test } from "bun:test"
import { authFailure } from "@/kilocode/mcp/auth-failure"

describe("authFailure", () => {
  test("recognizes recoverable MCP authentication failures", () => {
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
      "Server rejected the request: invalid_grant",
      "Server rejected the request: invalid_token",
    ]

    for (const message of cases) expect(authFailure(message)).toBe(true)
  })

  test("leaves unrelated MCP failures unchanged", () => {
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

  test("does not match unrelated numbers or hostnames", () => {
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

  test("does not match a missing error", () => {
    expect(authFailure(undefined)).toBe(false)
  })
})
