import { describe, expect, it } from "bun:test"
import { resolveComment, unresolveComment } from "../../src/agent-manager/pr/PRActions"

describe("resolveComment", () => {
  it("wraps gh failure with clean message", async () => {
    await expect(resolveComment("PRT_bad", "/nonexistent")).rejects.toThrow("Could not resolve thread")
  })
})

describe("unresolveComment", () => {
  it("wraps gh failure with clean message", async () => {
    await expect(unresolveComment("PRT_bad", "/nonexistent")).rejects.toThrow("Could not unresolve thread")
  })
})
