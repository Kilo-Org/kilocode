import { describe, expect, it } from "bun:test"
import { getFimSessionId } from "../../src/services/autocomplete/fim"

describe("autocomplete FIM sessions", () => {
  it("creates a stable opaque session per model and file", () => {
    const first = getFimSessionId("mtplx/Qwen3.5-9B-MTPLX", "/workspace/src/index.ts")
    const again = getFimSessionId("mtplx/Qwen3.5-9B-MTPLX", "/workspace/src/index.ts")
    const other = getFimSessionId("mtplx/Qwen3.5-9B-MTPLX", "/workspace/src/other.ts")

    expect(first).toBe(again)
    expect(first).toHaveLength(64)
    expect(first).not.toContain("workspace")
    expect(other).not.toBe(first)
  })

  it("omits a session when no stable scope is available", () => {
    expect(getFimSessionId("mtplx/Qwen3.5-9B-MTPLX")).toBeUndefined()
  })
})
