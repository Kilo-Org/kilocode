import { describe, expect, it } from "bun:test"
import type { AgentManagerStateMessage } from "../webview-ui/src/types/messages/agent-manager"
import { createProjectHydration } from "../webview-ui/agent-manager/project/hydration"
import { LOCAL } from "../webview-ui/agent-manager/navigate"

const ROOT = "/repo"
const WORKTREE = "/repo/.kilo/worktrees/one"
const SESSION = "s1"

function state(): AgentManagerStateMessage {
  return {
    type: "agentManager.state",
    projectId: "p1",
    worktrees: [{ id: "wt1", branch: "one", path: WORKTREE, parentBranch: "main", createdAt: "" }],
    sessions: [{ id: SESSION, worktreeId: "wt1", createdAt: "" }],
    activeTarget: { projectId: "p1", kind: "session", sessionId: SESSION },
  }
}

function setup() {
  let selection: string | null = null
  let current: string | undefined
  let catalog: { id: string; location?: { directory?: string } }[] = []
  let nextSwitch: "first" | "switched" | "same" = "switched"
  const calls: string[] = []

  const hydrate = createProjectHydration({
    switch: () => nextSwitch,
    restricted: () => {},
    repo: () => {},
    loaded: () => {},
    sessionsLoaded: () => {},
    style: () => {},
    markdown: () => {},
    current: () => current,
    settingUp: () => false,
    sessions: () => [],
    catalog: () => catalog,
    root: () => ROOT,
    tabs: () => [],
    closed: () => new Set<string>(),
    pending: () => false,
    setTabs: () => {},
    terminals: () => [],
    draft: () => {},
    restore: {
      selectLocal: () => {
        calls.push("local")
        selection = LOCAL
      },
      selectWorktree: (id) => {
        calls.push(`worktree:${id}`)
        selection = id
      },
      focusLocal: (id) => {
        calls.push(`focus-local:${id}`)
        selection = LOCAL
        current = id
      },
      focusManaged: (worktreeId, sessionId) => {
        calls.push(`focus-managed:${worktreeId}:${sessionId}`)
        selection = worktreeId
        current = sessionId
      },
      setSelection: (id) => {
        selection = id
      },
      setActivePendingId: () => {},
    },
    selection: () => selection,
    focus: () => {},
    sidebar: () => {},
  })

  return {
    hydrate,
    calls,
    setCatalog: (value: { id: string; location?: { directory?: string } }[]) => (catalog = value),
    setSwitch: (value: "first" | "switched" | "same") => (nextSwitch = value),
    selection: () => selection,
    setSelection: (value: string | null) => (selection = value),
    setCurrent: (value: string | undefined) => (current = value),
  }
}

describe("createProjectHydration catalog replay", () => {
  it("finishes a cold restore when the catalog later shows the project root", () => {
    const test = setup()
    test.hydrate(state())

    // Cold: the filing names the worktree because the catalog has no directory yet.
    expect(test.calls).toEqual(["focus-managed:wt1:s1"])
    expect(test.selection()).toBe("wt1")

    test.setCatalog([{ id: SESSION, location: { directory: ROOT } }])
    test.hydrate.catalog("p1")

    // Warm: the session actually runs in the root, so the restore must land on Local.
    expect(test.calls).toEqual(["focus-managed:wt1:s1", "focus-local:s1"])
    expect(test.selection()).toBe(LOCAL)
  })

  it("finishes a cold restore under the worktree that runs the session", () => {
    const test = setup()
    test.setSelection(LOCAL)
    test.hydrate(state())
    expect(test.calls).toEqual(["focus-managed:wt1:s1"])

    test.setCatalog([{ id: SESSION, location: { directory: WORKTREE } }])
    test.hydrate.catalog("p1")

    expect(test.calls).toEqual(["focus-managed:wt1:s1", "focus-managed:wt1:s1"])
  })

  it("keeps waiting when the catalog omits the session and finishes on the repaired state", () => {
    const test = setup()
    test.hydrate(state())
    expect(test.calls).toEqual(["focus-managed:wt1:s1"])

    // The session is outside the sidebar window, so this catalog cannot place it. The wait continues.
    test.setCatalog([])
    test.hydrate.catalog("p1")
    expect(test.calls).toEqual(["focus-managed:wt1:s1"])

    // The host's full repair pushes a state that files the session under Local. That state must finish the restore.
    test.setSwitch("same")
    test.hydrate({ ...state(), sessions: [{ id: SESSION, worktreeId: null, createdAt: "" }] })

    expect(test.calls).toEqual(["focus-managed:wt1:s1", "focus-local:s1"])
    expect(test.selection()).toBe(LOCAL)
  })

  it("does not pull the user back after they navigated during the catalog load", () => {
    const test = setup()
    test.hydrate(state())
    test.setSelection("other-worktree")
    test.setCurrent("other")

    test.setCatalog([{ id: SESSION, location: { directory: ROOT } }])
    test.hydrate.catalog("p1")

    expect(test.calls).toEqual(["focus-managed:wt1:s1"])
    expect(test.selection()).toBe("other-worktree")
  })
})
