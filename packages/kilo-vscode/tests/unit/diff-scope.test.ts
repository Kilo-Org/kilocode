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
    expect(parseDiffId(composeDiffId("wt_abc", "staged"))).toEqual({ ctx: "wt_abc", scope: "staged" })
    expect(parseDiffId(composeDiffId("wt_abc", "unstaged"))).toEqual({ ctx: "wt_abc", scope: "unstaged" })
    expect(parseDiffId(composeDiffId("wt_abc", "session"))).toEqual({ ctx: "wt_abc", scope: "session" })
  })

  it("embeds the active session id in the session scope", () => {
    const id = composeDiffId("wt_abc", "session", "ses_xyz")
    expect(id).toBe("wt_abc#session:ses_xyz")
    expect(parseDiffId(id)).toEqual({ ctx: "wt_abc", scope: "session", sessionId: "ses_xyz" })
    expect(parseDiffId(composeDiffId("local", "session", "ses_xyz"))).toEqual({
      ctx: "local",
      scope: "session",
      sessionId: "ses_xyz",
    })
  })

  it("parses context ids containing no separator as default branch scope", () => {
    expect(parseDiffId("wt_abc")).toEqual({ ctx: "wt_abc", scope: DEFAULT_DIFF_SCOPE })
  })

  it("treats an unknown trailing segment as part of the context, not a scope", () => {
    // A context id that happens to contain '#' but not a valid scope keeps the
    // full id as context and falls back to branch.
    expect(parseDiffId("wt_a#bogus")).toEqual({ ctx: "wt_a#bogus", scope: DEFAULT_DIFF_SCOPE })
  })

  it("isDiffScope guards the closed enum", () => {
    expect(isDiffScope("branch")).toBe(true)
    expect(isDiffScope("staged")).toBe(true)
    expect(isDiffScope("unstaged")).toBe(true)
    expect(isDiffScope("session")).toBe(true)
    expect(isDiffScope("session:ses_xyz")).toBe(false)
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
    expect(scopeToSourceId("branch", "wt_abc")).toBe("workspace")
    expect(scopeToSourceId("staged", "wt_abc")).toBe("staged")
    expect(scopeToSourceId("unstaged", "wt_abc")).toBe("unstaged")
    expect(scopeToSourceId("session", "wt_abc", "ses_xyz")).toBe("session:ses_xyz")
    expect(scopeToSourceId("session", "local", "ses_xyz")).toBe("session:ses_xyz")
    expect(scopeToSourceId("branch", "local")).toBe("workspace")
  })

  it("falls back to the context id for a session scope without a session id", () => {
    expect(scopeToSourceId("session", "ses_abc")).toBe("session:ses_abc")
  })
})
