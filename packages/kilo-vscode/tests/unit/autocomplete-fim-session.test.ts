import { describe, expect, it } from "bun:test"
import { getFimSessionId } from "../../src/services/autocomplete/fim"

describe("autocomplete FIM sessions", () => {
  it("creates a stable opaque session per model and file", () => {
    const first = getFimSessionId("lmstudio/qwen2.5-coder-1.5b", "/workspace/src/index.ts")
    const again = getFimSessionId("lmstudio/qwen2.5-coder-1.5b", "/workspace/src/index.ts")
    const other = getFimSessionId("lmstudio/qwen2.5-coder-1.5b", "/workspace/src/other.ts")

    expect(first).toBe(again)
    expect(first).toHaveLength(64)
    expect(first).not.toContain("workspace")
    expect(other).not.toBe(first)
  })

  it("omits a session when no stable scope is available", () => {
    expect(getFimSessionId("lmstudio/qwen2.5-coder-1.5b")).toBeUndefined()
  })
})
