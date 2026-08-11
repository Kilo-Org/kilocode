import { describe, expect, it, mock, beforeEach } from "bun:test"

const execGhRead = mock(async (_args: string[], _opts?: unknown) => ({ stdout: "{}", stderr: "" }))

mock.module("../../src/agent-manager/gh", () => ({ execGhRead }))

// await import is required here: static imports are hoisted before mock.module runs,
// so the mock would be bypassed. await import executes after mock.module, ensuring
// PRActions loads with execGhRead already mocked.
const { resolveComment, unresolveComment } = await import("../../src/agent-manager/pr/PRActions")

describe("resolveComment", () => {
  beforeEach(() => execGhRead.mockClear())

  it("wraps gh failure with clean message", async () => {
    execGhRead.mockRejectedValueOnce(new Error("gh: Not Found"))
    await expect(resolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not resolve thread")
  })
})

describe("unresolveComment", () => {
  beforeEach(() => execGhRead.mockClear())

  it("wraps gh failure with clean message", async () => {
    execGhRead.mockRejectedValueOnce(new Error("gh: Unauthorized"))
    await expect(unresolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not unresolve thread")
  })
})
