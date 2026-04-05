import { describe, it, expect } from "bun:test"
import { normalizeBaseBranch, chooseBaseBranch } from "../../src/agent-manager/base-branch"

describe("normalizeBaseBranch", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeBaseBranch(undefined)).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(normalizeBaseBranch("")).toBeUndefined()
  })

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeBaseBranch("   ")).toBeUndefined()
    expect(normalizeBaseBranch("\t\n")).toBeUndefined()
  })

  it("trims whitespace from valid input", () => {
    expect(normalizeBaseBranch("  main  ")).toBe("main")
    expect(normalizeBaseBranch(" develop\n")).toBe("develop")
  })

  it("returns the value as-is when already trimmed", () => {
    expect(normalizeBaseBranch("main")).toBe("main")
    expect(normalizeBaseBranch("feature/branch")).toBe("feature/branch")
  })
})

describe("chooseBaseBranch", () => {
  it("prefers explicit over configured", () => {
    const result = chooseBaseBranch({ explicit: "release", configured: "develop", configuredExists: true })
    expect(result).toEqual({ branch: "release" })
  })

  it("uses configured when it exists and no explicit is given", () => {
    const result = chooseBaseBranch({ configured: "develop", configuredExists: true })
    expect(result).toEqual({ branch: "develop" })
  })

  it("marks configured as stale when it no longer exists", () => {
    const result = chooseBaseBranch({ configured: "old-branch", configuredExists: false })
    expect(result).toEqual({ stale: "old-branch" })
  })

  it("falls back to auto-detect (undefined) when nothing is configured", () => {
    const result = chooseBaseBranch({})
    expect(result).toEqual({})
  })

  it("falls back to auto-detect when configured is undefined", () => {
    const result = chooseBaseBranch({ configured: undefined, configuredExists: false })
    expect(result).toEqual({})
  })

  it("explicit takes priority even when configured is stale", () => {
    const result = chooseBaseBranch({ explicit: "main", configured: "deleted", configuredExists: false })
    expect(result).toEqual({ branch: "main" })
  })
})
