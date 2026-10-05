/** Rows for the empty Agent Manager session. A row only shows when its action has something to show. */

type Stats = { files: number; additions: number; deletions: number }

export function hintRows(kb: Record<string, string>, state: { stats?: Stats; pr: boolean; worktrees: number }) {
  const changes = !!state.stats && (state.stats.files > 0 || state.stats.additions > 0 || state.stats.deletions > 0)
  const sessions = kb.previousSession && kb.nextSession ? [kb.previousSession, kb.nextSession] : []
  return [
    { label: "agentManager.hints.switchSession", bindings: sessions, show: state.worktrees > 0 },
    { label: "agentManager.shortcuts.toggleDiff", bindings: [kb.toggleDiff], show: changes },
    { label: "agentManager.shortcuts.openPR", bindings: [kb.openPR], show: state.pr },
    { label: "agentManager.shortcuts.toggleTerminal", bindings: [kb.showTerminal], show: true },
  ]
    .filter((row) => row.show && row.bindings.length > 0 && row.bindings.every(Boolean))
    .map((row) => ({ label: row.label, bindings: row.bindings }))
}
