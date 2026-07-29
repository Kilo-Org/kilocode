/**
 * Message handlers for Agent Manager worktree diff pushes.
 *
 * Extracted from AgentManagerApp's onMessage switch to keep that handler's
 * cyclomatic complexity and the file's line count under their lint caps.
 * Returns true when the message was a diff message (so the caller can skip
 * further handling).
 */

import type { Setter } from "solid-js"
import type {
  AgentManagerDiffBranchesMessage,
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerWorktreeDiffMessage,
  WorktreeFileDiff,
} from "../src/types/messages"
import { mergeWorktreeDiffs } from "../diff-viewer/diff-state"
import type { DiffReviewScope } from "./diff-review-scope"

export interface DiffMessageHandlers {
  setDiffDatas: Setter<Record<string, WorktreeFileDiff[]>>
  setDiffFilePending: (id: string, file: string, value: boolean) => void
  setDiffLoading: Setter<boolean>
  refreshStaleDiffs: (id: string, files: Set<string>) => void
  review: DiffReviewScope
}

/** Handle one inbound message; returns true when it was a diff message. */
export function handleDiffMessage(msg: { type: string }, h: DiffMessageHandlers): boolean {
  if (msg.type === "agentManager.worktreeDiff") {
    const ev = msg as AgentManagerWorktreeDiffMessage
    let staleFiles: Set<string> | undefined
    h.setDiffDatas((prev) => {
      const existing = prev[ev.sessionId]
      const merged = existing
        ? mergeWorktreeDiffs(existing, ev.diffs)
        : { diffs: ev.diffs, stale: new Set<string>() }
      staleFiles = merged.stale
      const next = merged.diffs
      if (existing && existing.length === next.length && existing.every((old, i) => old === next[i])) return prev
      return { ...prev, [ev.sessionId]: next }
    })
    if (staleFiles) h.refreshStaleDiffs(ev.sessionId, staleFiles)
    return true
  }

  if (msg.type === "agentManager.worktreeDiffFile") {
    const ev = msg as AgentManagerWorktreeDiffFileMessage
    if (ev.diff) {
      h.setDiffDatas((prev) => {
        const existing = prev[ev.sessionId] ?? []
        const next = existing.map((item) => (item.file === ev.diff!.file ? ev.diff! : item))
        return { ...prev, [ev.sessionId]: next }
      })
      h.setDiffFilePending(ev.sessionId, ev.diff.file, false)
      return true
    }
    h.setDiffFilePending(ev.sessionId, ev.file, false)
    return true
  }

  if (msg.type === "agentManager.worktreeDiffLoading") {
    h.setDiffLoading((msg as AgentManagerWorktreeDiffLoadingMessage).loading)
    return true
  }

  if (msg.type === "agentManager.diffBranches") {
    h.review.onBranches(msg as AgentManagerDiffBranchesMessage)
    return true
  }

  return false
}
