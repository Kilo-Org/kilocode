import { describe, it, expect } from "bun:test"
import { composeDiffId, parseDiffId, scopeDescriptors } from "../../webview-ui/agent-manager/diff-scope-state"

describe("agent-manager webview diff scope descriptors", () => {
  it("offers the three git scopes without an active session", () => {
    const descriptors = scopeDescriptors("wt_1")
    expect(descriptors.map((d) => d.type)).toEqual(["workspace", "staged", "unstaged"])
    expect(descriptors.map((d) => d.id)).toEqual(["wt_1#branch", "wt_1#staged", "wt_1#unstaged"])
  })

  it("adds the session scope with the active session embedded", () => {
    const descriptors = scopeDescriptors("wt_1", "ses_abc")
    expect(descriptors.map((d) => d.type)).toEqual(["workspace", "staged", "unstaged", "session"])
    const session = descriptors[3]!
    expect(session.id).toBe("wt_1#session:ses_abc")
    expect(session.group).toBe("Session")
    expect(session.capabilities.revert).toBe(false)
  })

  it("embeds the active local session for the local context", () => {
    const descriptors = scopeDescriptors("local", "ses_abc")
    expect(descriptors[3]!.id).toBe("local#session:ses_abc")
  })

  it("preserves legacy and malformed ids and parses the final separator", () => {
    expect(parseDiffId("local")).toEqual({ ctx: "local", scope: "branch" })
    expect(parseDiffId("wt_1#bogus")).toEqual({ ctx: "wt_1#bogus", scope: "branch" })
    expect(parseDiffId("wt_1#")).toEqual({ ctx: "wt_1#", scope: "branch" })
    expect(parseDiffId("wt#1#staged")).toEqual({ ctx: "wt#1", scope: "staged" })
    expect(parseDiffId("local#session:")).toEqual({ ctx: "local", scope: "session", sessionId: "" })
  })

  it("round-trips the session descriptor id", () => {
    expect(parseDiffId(composeDiffId("wt_1", "session", "ses_abc"))).toEqual({
      ctx: "wt_1",
      scope: "session",
      sessionId: "ses_abc",
    })
  })
})
