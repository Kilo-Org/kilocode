import { describe, it, expect } from "bun:test"
import { chooseBaseBranch, normalizeBaseBranch } from "../../src/agent-manager/base-branch"

describe("base-branch", () => {
  it("normalizes blank values", () => {
    expect(normalizeBaseBranch(undefined)).toBeUndefined()
    expect(normalizeBaseBranch("")).toBeUndefined()
    expect(normalizeBaseBranch("   ")).toBeUndefined()
  })

  it("normalizes branch names", () => {
    expect(normalizeBaseBranch(" main ")).toBe("main")
  })

  it("prefers explicit branch", () => {
    const choice = chooseBaseBranch({
      explicit: " develop ",
      configured: "main",
      configuredExists: false,
    })

    expect(choice.branch).toBe("develop")
    expect(choice.stale).toBeUndefined()
  })

  it("uses configured branch when it exists", () => {
    const choice = chooseBaseBranch({
      configured: "main",
      configuredExists: true,
    })

    expect(choice.branch).toBe("main")
    expect(choice.stale).toBeUndefined()
  })

  it("marks configured branch as stale when missing", () => {
    const choice = chooseBaseBranch({
      configured: "feature/missing",
      configuredExists: false,
    })

    expect(choice.branch).toBeUndefined()
    expect(choice.stale).toBe("feature/missing")
  })

  it("falls back to auto-detect when nothing is configured", () => {
    const choice = chooseBaseBranch({})
    expect(choice.branch).toBeUndefined()
    expect(choice.stale).toBeUndefined()
  })
})
