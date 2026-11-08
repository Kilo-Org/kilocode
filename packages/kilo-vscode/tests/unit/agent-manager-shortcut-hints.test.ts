import { describe, expect, it } from "bun:test"
import { hintRows } from "../../webview-ui/agent-manager/shortcut-hints"

const kb = {
  toggleDiff: "⌘D",
  showTerminal: "⌘/",
  openPR: "⌘⇧R",
  previousSession: "⌘⌥↑",
  nextSession: "⌘⌥↓",
}

const labels = (rows: ReturnType<typeof hintRows>) => rows.map((row) => row.label)

describe("agent manager empty session shortcut list", () => {
  it("new project with one session: only the terminal", () => {
    expect(labels(hintRows(kb, { pr: false, worktrees: 0 }))).toEqual(["agentManager.shortcuts.toggleTerminal"])
  })

  it("busy project: session switching first, then this worktree's changes and PR", () => {
    const rows = hintRows(kb, { stats: { files: 1, additions: 2, deletions: 0 }, pr: true, worktrees: 2 })
    expect(labels(rows)).toEqual([
      "agentManager.hints.switchSession",
      "agentManager.shortcuts.toggleDiff",
      "agentManager.shortcuts.openPR",
      "agentManager.shortcuts.toggleTerminal",
    ])
    expect(rows.at(0)?.bindings).toEqual(["⌘⌥↑", "⌘⌥↓"])
  })

  it("hides changes when the stats are empty and rows without a binding", () => {
    const rows = hintRows(
      { ...kb, openPR: "" },
      { stats: { files: 0, additions: 0, deletions: 0 }, pr: true, worktrees: 0 },
    )
    expect(labels(rows)).toEqual(["agentManager.shortcuts.toggleTerminal"])
  })
})
