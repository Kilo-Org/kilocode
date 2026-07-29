/**
 * Worktree diff data for Agent Manager.
 *
 * Owns the per-session diff map, the panel loading flag, and the per-file
 * pending set, plus the backend message handlers that fill them and the
 * helpers that request individual files. Extracted from `AgentManagerApp.tsx`
 * so the app component only routes the diff messages and reads the signals.
 */

import { createSignal, type Accessor } from "solid-js"
import { mergeWorktreeDiffs } from "../diff-viewer/diff-state"
import type { useVSCode } from "../src/context/vscode"
import type {
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerWorktreeDiffMessage,
  WorktreeFileDiff,
} from "../src/types/messages"

export function createWorktreeDiffs(vscode: ReturnType<typeof useVSCode>) {
  const [diffDatas, setDiffDatas] = createSignal<Record<string, WorktreeFileDiff[]>>({})
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffFileLoading, setDiffFileLoading] = createSignal<Record<string, Record<string, true>>>({})

  const setDiffFilePending = (sessionId: string, file: string, value: boolean) => {
    setDiffFileLoading((prev) => {
      const session = prev[sessionId] ?? {}
      if (value) {
        if (session[file]) return prev
        return {
          ...prev,
          [sessionId]: { ...session, [file]: true },
        }
      }

      if (!session[file]) return prev
      const next = { ...session }
      delete next[file]
      if (Object.keys(next).length === 0) {
        const result = { ...prev }
        delete result[sessionId]
        return result
      }
      return {
        ...prev,
        [sessionId]: next,
      }
    })
  }

  /** Lazily load a single file's full diff for the current session. */
  const requestDiffFile = (sessionId: string, file: string) => {
    if (diffFileLoading()[sessionId]?.[file]) return
    setDiffFilePending(sessionId, file, true)
    vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", sessionId, file })
  }

  /** Files the backend flagged as stale in a merged update need a fresh fetch. */
  const refreshStaleDiffs = (sessionId: string, files: Set<string>) => {
    const loading = diffFileLoading()[sessionId] ?? {}
    for (const file of files) {
      if (loading[file]) continue
      setDiffFilePending(sessionId, file, true)
      vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", sessionId, file })
    }
  }

  /** Files currently being fetched for a session, for per-file spinners. */
  const diffFileLoadingFor = (sessionId: Accessor<string | undefined>) => {
    const id = sessionId()
    if (!id) return new Set<string>()
    return new Set(Object.keys(diffFileLoading()[id] ?? {}))
  }

  // Backend messages.

  const onWorktreeDiff = (ev: AgentManagerWorktreeDiffMessage) => {
    let staleFiles: Set<string> | undefined
    setDiffDatas((prev) => {
      const existing = prev[ev.sessionId]
      const merged = existing ? mergeWorktreeDiffs(existing, ev.diffs) : { diffs: ev.diffs, stale: new Set<string>() }
      staleFiles = merged.stale
      const next = merged.diffs
      if (existing && existing.length === next.length && existing.every((old, i) => old === next[i])) return prev
      return { ...prev, [ev.sessionId]: next }
    })
    if (staleFiles) refreshStaleDiffs(ev.sessionId, staleFiles)
  }

  const onWorktreeDiffFile = (ev: AgentManagerWorktreeDiffFileMessage) => {
    if (ev.diff) {
      setDiffDatas((prev) => {
        const existing = prev[ev.sessionId] ?? []
        const next = existing.map((item) => (item.file === ev.diff!.file ? ev.diff! : item))
        return { ...prev, [ev.sessionId]: next }
      })
      setDiffFilePending(ev.sessionId, ev.diff.file, false)
      return
    }
    setDiffFilePending(ev.sessionId, ev.file, false)
  }

  const onWorktreeDiffLoading = (ev: AgentManagerWorktreeDiffLoadingMessage) => {
    setDiffLoading(ev.loading)
  }

  return {
    diffDatas,
    diffLoading,
    setDiffLoading,
    requestDiffFile,
    refreshStaleDiffs,
    diffFileLoadingFor,
    onWorktreeDiff,
    onWorktreeDiffFile,
    onWorktreeDiffLoading,
  }
}
