import { describe, expect, it } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { baseUpdateTarget } from "../webview-ui/agent-manager/base-update-target"

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_one",
    projectID: "prj_one",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/repo/.kilo/worktrees/first" },
    ...overrides,
  }
}

const managed = [{ id: "ses_one", worktreeId: "wt-first" }]

describe("baseUpdateTarget", () => {
  it("targets the visible session with its model, variant and agent", () => {
    const info = session({
      model: { id: "deepseek-v4.1-flash", providerID: "kilo", variant: "high" },
      agent: "code",
    })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "deepseek-v4.1-flash" },
      variant: "high",
      agent: "code",
    })
  })

  it("omits a model that has no effort and a session that has no agent", () => {
    const info = session({ model: { id: "kilo-auto-free", providerID: "kilo" } })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "kilo-auto-free" },
    })
  })

  it("omits the server default effort marker so the host does not send it back as an effort", () => {
    const info = session({ model: { id: "kilo-auto-free", providerID: "kilo", variant: "default" } })

    expect(baseUpdateTarget({ worktreeId: "wt-first", session: info, managedSessions: managed })).toEqual({
      sessionId: "ses_one",
      model: { providerID: "kilo", modelID: "kilo-auto-free" },
    })
  })

  it("leaves the host to choose when the managed state places the session in another worktree", () => {
    const info = session()

    expect(
      baseUpdateTarget({
        worktreeId: "wt-first",
        session: info,
        managedSessions: [{ id: "ses_one", worktreeId: "wt-second" }],
      }),
    ).toEqual({})
  })

  it("leaves the host to choose for a session only the catalog tagged with this worktree", () => {
    const info = session()

    // A session in the worktree directory that the managed state does not know is rejected by the host, so it
    // must not travel as a target.
    expect(
      baseUpdateTarget({
        worktreeId: "wt-first",
        session: info,
        managedSessions: [{ id: "ses_other", worktreeId: "wt-first" }],
      }),
    ).toEqual({})
  })

  it("leaves the host to choose when no session is visible", () => {
    expect(baseUpdateTarget({ worktreeId: "wt-first", session: undefined, managedSessions: managed })).toEqual({})
  })
})
