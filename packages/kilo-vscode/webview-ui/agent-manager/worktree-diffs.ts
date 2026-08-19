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
import { parseDiffId } from "./diff-scope-state"
import type { useVSCode } from "../src/context/vscode"
import type {
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerWorktreeDiffMessage,
  AgentManagerWorktreeDiffNoticeMessage,
  WorktreeFileDiff,
} from "../src/types/messages"

/**
 * Decompose a composite diff id (`ctx#scope`, or `ctx#session:<sid>`) into the
 * wire fields the extension expects. Bare ids (no scope separator) parse to
 * the default branch scope.
 */
export function wireDiffId(id: string, projectId?: string) {
  const { ctx, scope, sessionId } = parseDiffId(id)
  return { sessionId: ctx, scope, diffSessionId: sessionId, ...(projectId ? { projectId } : {}) }
}

export function createWorktreeDiffs(
  vscode: ReturnType<typeof useVSCode>,
  project: Accessor<string | undefined> = () => undefined,
) {
  const [diffDatas, setDiffDatas] = createSignal<Record<string, WorktreeFileDiff[]>>({})
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffNotices, setDiffNotices] = createSignal<Record<string, string | undefined>>({})
  const [diffFileLoading, setDiffFileLoading] = createSignal<Record<string, Record<string, true>>>({})
  const key = (id: string, projectId = project()) => (projectId ? `${projectId}\0${id}` : id)

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

  /** Lazily load a single file's full diff for the given composite diff id. */
  const requestDiffFile = (id: string, file: string) => {
    const dataKey = key(id)
    if (diffFileLoading()[dataKey]?.[file]) return
    setDiffFilePending(dataKey, file, true)
    vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", file, ...wireDiffId(id, project()) })
  }

  /** Files the backend flagged as stale in a merged update need a fresh fetch. */
  const refreshStaleDiffs = (id: string, files: Set<string>, projectId = project()) => {
    const dataKey = key(id, projectId)
    const loading = diffFileLoading()[dataKey] ?? {}
    for (const file of files) {
      if (loading[file]) continue
      setDiffFilePending(dataKey, file, true)
      vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", file, ...wireDiffId(id, projectId) })
    }
  }

  /** Files currently being fetched for a session, for per-file spinners. */
  const diffFileLoadingFor = (sessionId: Accessor<string | undefined>) => {
    const id = sessionId()
    if (!id) return new Set<string>()
    return new Set(Object.keys(diffFileLoading()[key(id)] ?? {}))
  }

  // Backend messages.

  const onWorktreeDiff = (ev: AgentManagerWorktreeDiffMessage) => {
    const dataKey = key(ev.sessionId, ev.projectId)
    let staleFiles: Set<string> | undefined
    setDiffDatas((prev) => {
      const existing = prev[dataKey]
      const merged = existing ? mergeWorktreeDiffs(existing, ev.diffs) : { diffs: ev.diffs, stale: new Set<string>() }
      staleFiles = merged.stale
      const next = merged.diffs
      if (existing && existing.length === next.length && existing.every((old, i) => old === next[i])) return prev
      return { ...prev, [dataKey]: next }
    })
    if (staleFiles) refreshStaleDiffs(ev.sessionId, staleFiles, ev.projectId)
  }

  const onWorktreeDiffFile = (ev: AgentManagerWorktreeDiffFileMessage) => {
    const dataKey = key(ev.sessionId, ev.projectId)
    if (ev.diff) {
      setDiffDatas((prev) => {
        const existing = prev[dataKey] ?? []
        const next = existing.map((item) => (item.file === ev.diff!.file ? ev.diff! : item))
        return { ...prev, [dataKey]: next }
      })
      setDiffFilePending(dataKey, ev.diff.file, false)
      return
    }
    setDiffFilePending(dataKey, ev.file, false)
  }

  const onWorktreeDiffLoading = (ev: AgentManagerWorktreeDiffLoadingMessage) => {
    if (ev.projectId !== undefined && ev.projectId !== project()) return
    setDiffLoading(ev.loading)
  }

  const onWorktreeDiffNotice = (ev: AgentManagerWorktreeDiffNoticeMessage) => {
    setDiffNotices((prev) => ({ ...prev, [key(ev.sessionId, ev.projectId)]: ev.notice }))
  }

  return {
    diffDatas,
    diffLoading,
    setDiffLoading,
    diffNotices,
    dataKey: key,
    requestDiffFile,
    refreshStaleDiffs,
    diffFileLoadingFor,
    onWorktreeDiff,
    onWorktreeDiffFile,
    onWorktreeDiffLoading,
    onWorktreeDiffNotice,
  }
}
