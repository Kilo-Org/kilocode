import { describe, expect, test } from "bun:test"
import type { AuthStatus } from "../../../src/mcp"
import { connectedOutcome } from "../../../src/kilocode/mcp/auth-outcome"

describe("connectedOutcome", () => {
  test("succeeds only when credentials are stored", () => {
    expect(connectedOutcome("google_drive", "authenticated")).toStrictEqual({ ok: true })
  })

  const cases: AuthStatus[] = ["not_authenticated", "expired"]
  test.each(cases)(
    "fails with an explanation when stored status is %s (server never issued an OAuth challenge)",
    (stored) => {
      const outcome = connectedOutcome("google_drive", stored)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error("expected failure")
      expect(outcome.message).toContain("google_drive")
      expect(outcome.message).toContain("no credentials were stored")
    },
  )
})
