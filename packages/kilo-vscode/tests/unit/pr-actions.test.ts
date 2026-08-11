import { describe, expect, it, mock, beforeEach } from "bun:test"

const execGhRead = mock(async (_args: string[], _opts?: unknown) => ({ stdout: "{}", stderr: "" }))

mock.module("../../src/agent-manager/gh", () => ({ execGhRead }))

const { resolveComment, unresolveComment } = await import("../../src/agent-manager/pr/PRActions")

describe("resolveComment", () => {
  beforeEach(() => execGhRead.mockReset())

  it("calls gh api graphql with resolveReviewThread mutation", async () => {
    execGhRead.mockResolvedValueOnce({ stdout: "{}", stderr: "" })
    await resolveComment("PRT_abc123", "/repo")
    const args = execGhRead.mock.calls[0]?.[0] as string[]
    expect(args).toContain("api")
    expect(args).toContain("graphql")
    expect(args.some((a) => a.includes("resolveReviewThread"))).toBe(true)
  })

  it("passes threadId as the id variable", async () => {
    execGhRead.mockResolvedValueOnce({ stdout: "{}", stderr: "" })
    await resolveComment("PRT_abc123", "/repo")
    const args = execGhRead.mock.calls[0]?.[0] as string[]
    expect(args.some((a) => a.includes("PRT_abc123"))).toBe(true)
  })

  it("throws a clean error when gh fails", async () => {
    execGhRead.mockRejectedValueOnce(new Error("gh: Not Found"))
    await expect(resolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not resolve thread")
  })
})

describe("unresolveComment", () => {
  beforeEach(() => execGhRead.mockReset())

  it("calls gh api graphql with unresolveReviewThread mutation", async () => {
    execGhRead.mockResolvedValueOnce({ stdout: "{}", stderr: "" })
    await unresolveComment("PRT_abc123", "/repo")
    const args = execGhRead.mock.calls[0]?.[0] as string[]
    expect(args.some((a) => a.includes("unresolveReviewThread"))).toBe(true)
  })

  it("throws a clean error when gh fails", async () => {
    execGhRead.mockRejectedValueOnce(new Error("gh: Unauthorized"))
    await expect(unresolveComment("PRT_bad", "/repo")).rejects.toThrow("Could not unresolve thread")
  })
})
