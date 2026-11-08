import { describe, expect, it } from "bun:test"
import { needsAuthNames } from "../../src/services/mcp-auth/status"

describe("needsAuthNames", () => {
  it("returns only needs_auth servers, sorted", () => {
    const names = needsAuthNames({
      zebra: { status: "needs_auth" },
      anaconda: { status: "failed", error: "Unauthorized: authentication required" },
      connected: { status: "connected" },
      disabled: { status: "disabled" },
    })
    expect(names).toEqual(["zebra"])
  })

  it("returns an empty array when nothing needs auth", () => {
    expect(needsAuthNames({ ok: { status: "connected" } })).toEqual([])
  })
})
