import { describe, it, expect } from "bun:test"
import {
  composeDiffId,
  parseDiffId,
  isDiffScope,
  normalizeScope,
  scopeToSourceId,
  DEFAULT_DIFF_SCOPE,
} from "../../src/agent-manager/diff-scope"

describe("diff-scope composite ids", () => {
  it("round-trips context and scope", () => {
    expect(parseDiffId(composeDiffId("local", "branch"))).toEqual({ ctx: "local", scope: "branch" })
    expect(parseDiffId(composeDiffId("ses_abc", "staged"))).toEqual({ ctx: "ses_abc", scope: "staged" })
    expect(parseDiffId(composeDiffId("ses_abc", "unstaged"))).toEqual({ ctx: "ses_abc", scope: "unstaged" })
    expect(parseDiffId(composeDiffId("ses_abc", "session"))).toEqual({ ctx: "ses_abc", scope: "session" })
  })

  it("parses session ids containing no separator as default branch scope", () => {
    expect(parseDiffId("ses_abc")).toEqual({ ctx: "ses_abc", scope: DEFAULT_DIFF_SCOPE })
  })

  it("treats an unknown trailing segment as part of the context, not a scope", () => {
    // A session id that happens to contain '#' but not a valid scope keeps the
    // full id as context and falls back to branch.
    expect(parseDiffId("ses_a#bogus")).toEqual({ ctx: "ses_a#bogus", scope: DEFAULT_DIFF_SCOPE })
  })

  it("isDiffScope guards the closed enum", () => {
    expect(isDiffScope("branch")).toBe(true)
    expect(isDiffScope("staged")).toBe(true)
    expect(isDiffScope("unstaged")).toBe(true)
    expect(isDiffScope("session")).toBe(true)
    expect(isDiffScope("turn")).toBe(false)
    expect(isDiffScope("")).toBe(false)
  })

  it("normalizeScope falls back to branch for unknown input", () => {
    expect(normalizeScope("staged")).toBe("staged")
    expect(normalizeScope("nope")).toBe("branch")
    expect(normalizeScope(undefined)).toBe("branch")
    expect(normalizeScope(42)).toBe("branch")
  })

  it("maps scopes to catalog source ids", () => {
    expect(scopeToSourceId("branch", "ses_abc")).toBe("workspace")
    expect(scopeToSourceId("staged", "ses_abc")).toBe("staged")
    expect(scopeToSourceId("unstaged", "ses_abc")).toBe("unstaged")
    expect(scopeToSourceId("session", "ses_abc")).toBe("session:ses_abc")
    expect(scopeToSourceId("branch", "local")).toBe("workspace")
  })
})
