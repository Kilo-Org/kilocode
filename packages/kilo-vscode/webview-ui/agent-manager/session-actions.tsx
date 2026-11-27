import type { JSX } from "solid-js"
import type { LocalGitStats, WorktreeGitStats } from "../src/types/messages/agent-manager"
import { SessionActionsRow } from "../src/v2/session-actions-row"
import { freezeValue, useViewActive } from "../src/v2/view-active"
import { LOCAL } from "./navigate"

export function createSessionActionsRenderer(deps: {
  sessionId: () => string | undefined
  selection: () => string | null
  readOnly: () => boolean
  localSessionIDs: () => string[]
  isPending: (id: string) => boolean
  localStats: () => LocalGitStats | undefined
  worktreeStats: () => Record<string, WorktreeGitStats>
  isGitRepo: () => boolean
  branch: () => string | undefined
  transferring: () => boolean
  detail: () => string
  onNewWorktree: () => void
  onNewWorktreeFromBranch: (branch: string) => void
  onConfigureWorktree: () => void
  onMoveToWorktree: (id: string) => void
  onShowChanges: () => void
}) {
  return (hasMessages: boolean, todos: JSX.Element, agents: JSX.Element) => {
    const active = useViewActive()
    const id = freezeValue(active, deps.sessionId)
    const sel = freezeValue(active, deps.selection)
    const ro = freezeValue(active, deps.readOnly)
    const locals = freezeValue(active, deps.localSessionIDs)
    const movable = () => sel() === LOCAL && !ro() && !!id() && locals().includes(id()!) && !deps.isPending(id()!)
    const stats = freezeValue(active, () => (sel() === LOCAL ? deps.localStats() : deps.worktreeStats()[sel() ?? ""]))
    const branch = freezeValue(active, () => (deps.isGitRepo() ? deps.branch() : undefined))
    const moving = freezeValue(active, deps.transferring)
    const detail = freezeValue(active, deps.detail)
    return (
      <SessionActionsRow
        hasMessages={hasMessages}
        branch={branch()}
        onNewWorktree={deps.onNewWorktree}
        onNewWorktreeFromBranch={deps.onNewWorktreeFromBranch}
        onConfigureWorktree={deps.onConfigureWorktree}
        onMoveToWorktree={movable() && id() ? () => deps.onMoveToWorktree(id()!) : undefined}
        moving={moving()}
        moveDetail={detail()}
        stats={stats()}
        onShowChanges={deps.onShowChanges}
        todos={todos}
        agents={agents}
      />
    )
  }
}
