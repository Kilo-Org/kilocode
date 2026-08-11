import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import * as ghModule from "../../src/agent-manager/gh"
import { resolveComment, unresolveComment } from "../../src/agent-manager/pr/PRActions"

describe("resolveComment", () => {
  let execGhReadSpy: ReturnType<typeof mock>

  beforeEach(() => {
    execGhReadSpy = mock(ghModule, "execGhRead", async (_args: string[], _opts?: unknown) => ({
      stdout: "{}",
      stderr: "",
    }))
  })

  afterEach(() => {
    execGhReadSpy.mockRestore()
  })

  it("wraps gh failure with clean message", async () => {
    execGhReadSpy.mockRejectedValueOnce(new Error("gh: Not Found"))
    await expect(resolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not resolve thread")
  })
})

describe("unresolveComment", () => {
  let execGhReadSpy: ReturnType<typeof mock>

  beforeEach(() => {
    execGhReadSpy = mock(ghModule, "execGhRead", async (_args: string[], _opts?: unknown) => ({
      stdout: "{}",
      stderr: "",
    }))
  })

  afterEach(() => {
    execGhReadSpy.mockRestore()
  })

  it("wraps gh failure with clean message", async () => {
    execGhReadSpy.mockRejectedValueOnce(new Error("gh: Unauthorized"))
    await expect(unresolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not unresolve thread")
  })
})
