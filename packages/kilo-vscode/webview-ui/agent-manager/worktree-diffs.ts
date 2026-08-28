/**
 * Worktree diff data for Agent Manager.
 *
 * Owns the per-session diff map, the panel loading flag, and the per-file
 * pending set, plus the backend message handlers that fill them and the
 * helpers that request individual files. Extracted from `AgentManagerApp.tsx`
 * so the app component only routes the diff messages and reads the signals.
 */

import { createSignal, type Accessor } from "solid-js"
import { zeroID } from "@opencode-ai/core/kilocode/zero-id"
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

const LIMIT = 16
const BUDGET = 64 * 1024 * 1024

/**
 * Decompose a composite diff id (`ctx#scope`, or `ctx#session:<sid>`) into the
 * wire fields the extension expects. Bare ids (no scope separator) parse to
 * the default branch scope.
 */
export function wireDiffId(id: string) {
  const { ctx, scope, sessionId } = parseDiffId(id)
  return { sessionId: ctx, scope, diffSessionId: sessionId }
}

export function diffDataKey(project: string | undefined, id: string): string {
  return zeroID(project ?? "single", id)
}

export function createWorktreeDiffs(
  vscode: ReturnType<typeof useVSCode>,
  project: () => string | undefined = () => undefined,
) {
  const [diffDatas, setDiffDatas] = createSignal<Record<string, WorktreeFileDiff[]>>({})
  const [diffLoadings, setDiffLoadings] = createSignal<Record<string, true>>({})
  const diffLoading = () => Object.keys(diffLoadings()).length > 0
  const [diffNotices, setDiffNotices] = createSignal<Record<string, string | undefined>>({})
  const [diffFileLoading, setDiffFileLoading] = createSignal<Record<string, Record<string, true>>>({})
  const sizes = new Map<string, number>()
  let bytes = 0

  const key = (id: string) => diffDataKey(project(), id)

  const reset = () => {
    sizes.clear()
    bytes = 0
    setDiffDatas({})
    setDiffLoadings({})
    setDiffNotices({})
    setDiffFileLoading({})
  }

  const drop = (id: string) => {
    const data = id.includes("\0") ? id : key(id)
    const size = sizes.get(data)
    if (size !== undefined) {
      bytes -= size
      sizes.delete(data)
    }
    const remove = <T extends Record<string, unknown>>(prev: T): T => {
      if (!(data in prev)) return prev
      const next = { ...prev }
      delete next[data]
      return next
    }
    setDiffDatas(remove)
    setDiffLoadings(remove)
    setDiffNotices(remove)
    setDiffFileLoading(remove)
  }

  const prune = (ids: Set<string>) => {
    const prefix = key("")
    const keys = new Set([
      ...Object.keys(diffDatas()),
      ...Object.keys(diffLoadings()),
      ...Object.keys(diffNotices()),
      ...Object.keys(diffFileLoading()),
    ])
    for (const data of keys) {
      if (!data.startsWith(prefix)) continue
      const ctx = parseDiffId(data.slice(prefix.length)).ctx
      if (ctx !== "local" && !ids.has(ctx)) drop(data)
    }
  }

  const retain = (id: string) => {
    const data = id.includes("\0") ? id : key(id)
    const entries = diffDatas()[data]
    if (!entries) return
    const size = entries.reduce(
      (total, item) =>
        total +
        2 *
          (item.before.length +
            item.after.length +
            (item.patch?.length ?? 0) +
            (item.image?.before?.data?.length ?? 0) +
            (item.image?.after?.data?.length ?? 0)),
      0,
    )
    bytes -= sizes.get(data) ?? 0
    sizes.delete(data)
    sizes.set(data, size)
    bytes += size
    while ((sizes.size > LIMIT || bytes > BUDGET) && sizes.size > 1) {
      const oldest = sizes.keys().next().value
      if (!oldest) return
      drop(oldest)
    }
  }

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
    const data = key(id)
    if (diffFileLoading()[data]?.[file]) return
    setDiffFilePending(data, file, true)
    vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", projectId: project(), file, ...wireDiffId(id) })
  }

  /** Files the backend flagged as stale in a merged update need a fresh fetch. */
  const refreshStaleDiffs = (id: string, files: Set<string>, data = key(id), owner = project()) => {
    const loading = diffFileLoading()[data] ?? {}
    for (const file of files) {
      if (loading[file]) continue
      setDiffFilePending(data, file, true)
      vscode.postMessage({
        type: "agentManager.requestWorktreeDiffFile",
        projectId: owner,
        file,
        ...wireDiffId(id),
      })
    }
  }

  /** Files currently being fetched for a session, for per-file spinners. */
  const diffFileLoadingFor = (sessionId: Accessor<string | undefined>) => {
    const id = sessionId()
    if (!id) return new Set<string>()
    return new Set(Object.keys(diffFileLoading()[key(id)] ?? {}))
  }

  /** Initial summary loading for one composite diff id. Cached results stay visible while refreshing. */
  const diffLoadingFor = (sessionId: Accessor<string | undefined>) => {
    const id = sessionId()
    if (!id) return false
    const data = key(id)
    return diffLoadings()[data] === true && !(data in diffDatas())
  }

  // Backend messages.

  const onWorktreeDiff = (ev: AgentManagerWorktreeDiffMessage) => {
    const data = diffDataKey(ev.projectId, ev.sessionId)
    let staleFiles: Set<string> | undefined
    setDiffDatas((prev) => {
      const existing = prev[data]
      const merged = existing ? mergeWorktreeDiffs(existing, ev.diffs) : { diffs: ev.diffs, stale: new Set<string>() }
      staleFiles = merged.stale
      const next = merged.diffs
      if (existing && existing.length === next.length && existing.every((old, i) => old === next[i])) return prev
      return { ...prev, [data]: next }
    })
    retain(data)
    if (staleFiles) refreshStaleDiffs(ev.sessionId, staleFiles, data, ev.projectId)
  }

  const onWorktreeDiffFile = (ev: AgentManagerWorktreeDiffFileMessage) => {
    const data = diffDataKey(ev.projectId, ev.sessionId)
    if (ev.diff) {
      setDiffDatas((prev) => {
        const existing = prev[data] ?? []
        const next = existing.map((item) => (item.file === ev.diff!.file ? ev.diff! : item))
        return { ...prev, [data]: next }
      })
      retain(data)
      setDiffFilePending(data, ev.diff.file, false)
      return
    }
    setDiffFilePending(data, ev.file, false)
  }

  const onWorktreeDiffLoading = (ev: AgentManagerWorktreeDiffLoadingMessage) => {
    const data = diffDataKey(ev.projectId, ev.sessionId)
    // One source is active per project. Replacing the map on start also clears
    // an interrupted source whose stale completion is intentionally discarded.
    if (ev.loading) {
      setDiffLoadings({ [data]: true })
      return
    }
    setDiffLoadings((prev) => {
      if (!prev[data]) return prev
      const next = { ...prev }
      delete next[data]
      return next
    })
  }

  const onWorktreeDiffNotice = (ev: AgentManagerWorktreeDiffNoticeMessage) => {
    setDiffNotices((prev) => ({ ...prev, [diffDataKey(ev.projectId, ev.sessionId)]: ev.notice }))
  }

  return {
    diffDatas,
    diffLoading,
    setDiffLoading: (loading: boolean) => setDiffLoadings(loading ? diffLoadings() : {}),
    diffNotices,
    requestDiffFile,
    refreshStaleDiffs,
    diffFileLoadingFor,
    diffLoadingFor,
    diffDataKey,
    retain,
    drop,
    prune,
    reset,
    onWorktreeDiff,
    onWorktreeDiffFile,
    onWorktreeDiffLoading,
    onWorktreeDiffNotice,
  }
}
