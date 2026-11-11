/** Rows for the empty Agent Manager session. A row only shows when its action has something to show. */

import type { ManagerContext } from "../src/v2/shortcut-hint"
import { LOCAL, type NavEntry } from "./navigate"
import { SidePanel } from "./side-panel-layout"
import type { Activity } from "./v2/activity"

type Stats = { files: number; additions: number; deletions: number }

export function hintRows(
  kb: Record<string, string>,
  state: { stats?: Stats; pr: boolean; worktrees: number; worktree?: boolean },
) {
  const changes = !!state.stats && (state.stats.files > 0 || state.stats.additions > 0 || state.stats.deletions > 0)
  const sessions = kb.previousSession && kb.nextSession ? [kb.previousSession, kb.nextSession] : []
  return [
    { label: "agentManager.hints.switchSession", bindings: sessions, show: state.worktrees > 0 },
    { label: "agentManager.shortcuts.toggleDiff", bindings: [kb.toggleDiff], show: changes },
    { label: "agentManager.shortcuts.openPR", bindings: [kb.openPR], show: state.pr },
    // A second task runs in its own worktree, and the selected worktree can open as a folder.
    { label: "agentManager.shortcuts.newWorktree", bindings: [kb.quickWorktree], show: true },
    { label: "agentManager.shortcuts.openWorktree", bindings: [kb.openWorktree], show: !!state.worktree },
    { label: "agentManager.shortcuts.toggleTerminal", bindings: [kb.showTerminal], show: true },
  ]
    .filter((row) => row.show && row.bindings.length > 0 && row.bindings.every(Boolean))
    .map((row) => ({ label: row.label, bindings: row.bindings }))
}

/**
 * The prompt hint context of the Agent Manager sidebar. The jump number is the position of a waiting session in the
 * sidebar order, which is the same order the numeric shortcut badges use, so `index + 1` names the key that jumps to
 * that session.
 */
export function hintManager(input: {
  nav: NavEntry[]
  selection: string | null
  activeProjectId: string | undefined
  activity: (projectId: string, worktree: string | null) => Activity
  changes: boolean
  pr: boolean
  panel?: SidePanel | null
}) {
  const selected = (entry: NavEntry) => {
    const target = entry.target
    if (target.projectId !== input.activeProjectId) return false
    if (target.kind === "local") return input.selection === LOCAL
    if (target.kind === "worktree") return input.selection === target.worktreeId
    return false
  }
  const waiting = input.nav.findIndex(
    (entry) =>
      !selected(entry) &&
      input.activity(entry.target.projectId, entry.target.kind === "worktree" ? entry.target.worktreeId : null) ===
        "waiting",
  )
  const panel = input.panel
  return {
    changes: input.changes,
    pr: input.pr,
    panel: panel === SidePanel.Diff ? "diff" : panel === SidePanel.PR ? "pr" : panel ? "other" : undefined,
    worktrees: input.nav.filter((entry) => entry.target.kind === "worktree").length,
    waiting: waiting >= 0 && waiting < 9 ? waiting + 1 : undefined,
  } satisfies ManagerContext
}
