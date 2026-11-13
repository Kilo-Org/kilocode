import { describe, expect, it } from "bun:test"
import { hintManager, hintRows } from "../webview-ui/agent-manager/shortcut-hints"
import { LOCAL, type NavEntry } from "../webview-ui/agent-manager/navigate"
import { SidePanel } from "../webview-ui/agent-manager/side-panel-layout"
import type { Activity } from "../webview-ui/agent-manager/v2/activity"

const kb = {
  toggleDiff: "⌘D",
  showTerminal: "⌘/",
  openPR: "⌘⇧R",
  previousSession: "⌘⌥↑",
  nextSession: "⌘⌥↓",
  quickWorktree: "⌘⇧N",
  openWorktree: "⌘⇧O",
}

const labels = (rows: ReturnType<typeof hintRows>) => rows.map((row) => row.label)

describe("agent manager empty session shortcut list", () => {
  it("new project on local: the worktree action and the terminal", () => {
    expect(labels(hintRows(kb, { pr: false, worktrees: 0 }))).toEqual([
      "agentManager.shortcuts.newWorktree",
      "agentManager.shortcuts.toggleTerminal",
    ])
  })

  it("a selected worktree also offers opening it as a folder", () => {
    expect(labels(hintRows(kb, { pr: false, worktrees: 0, worktree: true }))).toEqual([
      "agentManager.shortcuts.newWorktree",
      "agentManager.shortcuts.openWorktree",
      "agentManager.shortcuts.toggleTerminal",
    ])
  })

  it("busy project: session switching first, then this worktree's changes and PR", () => {
    const rows = hintRows(kb, { stats: { files: 1, additions: 2, deletions: 0 }, pr: true, worktrees: 2 })
    expect(labels(rows)).toEqual([
      "agentManager.hints.switchSession",
      "agentManager.shortcuts.toggleDiff",
      "agentManager.shortcuts.openPR",
      "agentManager.shortcuts.newWorktree",
      "agentManager.shortcuts.toggleTerminal",
    ])
    expect(rows.at(0)?.bindings).toEqual(["⌘⌥↑", "⌘⌥↓"])
  })

  it("hides changes when the stats are empty and rows without a binding", () => {
    const rows = hintRows(
      { ...kb, openPR: "" },
      { stats: { files: 0, additions: 0, deletions: 0 }, pr: true, worktrees: 0 },
    )
    expect(labels(rows)).toEqual(["agentManager.shortcuts.newWorktree", "agentManager.shortcuts.toggleTerminal"])
  })
})

describe("agent manager prompt hint context", () => {
  const local: NavEntry = { id: "p1:local", target: { projectId: "p1", kind: "local" } }
  const other: NavEntry = { id: "p1:wt:a", target: { projectId: "p1", kind: "worktree", worktreeId: "a" } }
  const third: NavEntry = { id: "p1:wt:b", target: { projectId: "p1", kind: "worktree", worktreeId: "b" } }
  const elsewhere: NavEntry = { id: "p2:local", target: { projectId: "p2", kind: "local" } }

  const build = (input: {
    nav?: NavEntry[]
    selection?: string | null
    activity?: Record<string, Activity>
    panel?: SidePanel | null
  }) =>
    hintManager({
      nav: input.nav ?? [local, other, third],
      selection: input.selection === undefined ? LOCAL : input.selection,
      activeProjectId: "p1",
      activity: (projectId, worktree) => input.activity?.[`${projectId}:${worktree ?? "local"}`] ?? "idle",
      changes: true,
      pr: false,
      panel: input.panel,
    })

  it("numbers a waiting session by its sidebar position, which is the badge the jump shortcut uses", () => {
    // Local is index 0 (⌘1), so the first worktree is ⌘2 even though it is not selected.
    expect(build({ activity: { "p1:a": "waiting" } }).waiting).toBe(2)
    expect(build({ activity: { "p1:b": "waiting" } }).waiting).toBe(3)
  })

  it("skips the selected worktree, because its session is already on screen", () => {
    expect(build({ selection: "a", activity: { "p1:a": "waiting" } }).waiting).toBeUndefined()
    expect(build({ selection: "b", activity: { "p1:b": "waiting" } }).waiting).toBeUndefined()
  })

  it("numbers a waiting session of another expanded project, which carries a badge too", () => {
    expect(build({ nav: [local, elsewhere], activity: { "p2:local": "waiting" } }).waiting).toBe(2)
  })

  it("has no jump number beyond the ninth sidebar entry", () => {
    const worktrees: NavEntry[] = Array.from({ length: 10 }, (_, index) => ({
      id: `p1:wt:w${index}`,
      target: { projectId: "p1", kind: "worktree" as const, worktreeId: `w${index}` },
    }))
    const jump = (waitingWorktree: string) =>
      hintManager({
        nav: [local, ...worktrees],
        selection: "w0",
        activeProjectId: "p1",
        activity: (_projectId, worktree) => (worktree === waitingWorktree ? "waiting" : "idle"),
        changes: false,
        pr: false,
      }).waiting
    // w7 sits at index 8, so its badge is ⌘9; w8 would be the tenth entry.
    expect(jump("w7")).toBe(9)
    expect(jump("w8")).toBeUndefined()
  })

  it("maps the open side panel to the hint panel value", () => {
    expect(build({ panel: SidePanel.Diff }).panel).toBe("diff")
    expect(build({ panel: SidePanel.PR }).panel).toBe("pr")
    expect(build({ panel: SidePanel.Terminal }).panel).toBe("other")
    expect(build({ panel: undefined }).panel).toBeUndefined()
  })

  it("counts the worktrees in the sidebar and passes the review state through", () => {
    const manager = build({ activity: {} })
    expect(manager.worktrees).toBe(2)
    expect(manager.changes).toBe(true)
    expect(manager.pr).toBe(false)
  })
})
