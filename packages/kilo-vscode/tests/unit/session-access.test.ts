import { describe, expect, it } from "bun:test"
import { interactiveSessionIds, isReadOnlySession } from "../../webview-ui/agent-manager/session-access"

describe("isReadOnlySession", () => {
  it("keeps unassigned subagent sessions interactive when their parent is managed", () => {
    expect(
      isReadOnlySession({
        selection: null,
        sessionId: "child",
        parents: new Map([["child", "parent"]]),
        interactive: new Set(["parent"]),
      }),
    ).toBe(false)
  })

  it("marks unassigned unrelated sessions as read-only", () => {
    expect(
      isReadOnlySession({
        selection: null,
        sessionId: "orphan",
        parents: new Map(),
        interactive: new Set(["parent"]),
      }),
    ).toBe(true)
  })

  it("keeps subagent sessions interactive when a grandparent is managed", () => {
    expect(
      isReadOnlySession({
        selection: null,
        sessionId: "grandchild",
        parents: new Map([
          ["grandchild", "child"],
          ["child", "parent"],
        ]),
        interactive: new Set(["parent"]),
      }),
    ).toBe(false)
  })

  it("marks circular parent chains as read-only when no ancestor is interactive", () => {
    expect(
      isReadOnlySession({
        selection: null,
        sessionId: "child",
        parents: new Map([
          ["child", "parent"],
          ["parent", "child"],
        ]),
        interactive: new Set(),
      }),
    ).toBe(true)
  })

  it("keeps selected local or worktree sessions interactive", () => {
    expect(
      isReadOnlySession({
        selection: "local",
        sessionId: "orphan",
        parents: new Map(),
        interactive: new Set(),
      }),
    ).toBe(false)
  })
})

describe("interactiveSessionIds", () => {
  it("combines local sessions, worktree sessions, and the local context id", () => {
    expect(interactiveSessionIds({ local: ["local-session"], worktree: new Set(["worktree-session"]) })).toEqual(
      new Set(["local-session", "worktree-session", "local"]),
    )
  })
})
