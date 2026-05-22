import type { DeltaEntry, ExportEvent, FileEntry, WorkspaceBaselineCompleted, WorkspaceDeltaCaptured } from "./events"
import { ulid } from "./ulid"

export type BaselineFiberArgs = {
  sessionId: string
  rootSessionId: string
  timeoutMs: number
  now: () => number
  syncSeq: () => number
  agentVersion: string
  requestSnapshot: () => Promise<{ snapshotId: string; files: FileEntry[] }>
  dispatch: (envelope: ExportEvent) => void
}

export type DeltaFiberArgs = {
  sessionId: string
  rootSessionId: string
  trigger: "next_request" | "session_close"
  prevSnapshotHash: string
  now: () => number
  syncSeq: () => number
  agentVersion: string
  requestDiff: (prevSnapshotHash: string) => Promise<{ snapshotHash: string; diff: DeltaEntry[] }>
  dispatch: (envelope: ExportEvent) => void
}

export async function startBaselineFiber(args: BaselineFiberArgs): Promise<string | undefined> {
  const result = await resolveBaseline(args)
  const env: WorkspaceBaselineCompleted = {
    id: ulid(),
    schemaVersion: 1,
    type: "workspace_baseline_completed",
    sessionId: args.sessionId,
    rootSessionId: args.rootSessionId,
    seq: args.syncSeq(),
    ts: args.now(),
    agentVersion: args.agentVersion,
    snapshotId: result.snapshotId,
    consistency: result.consistency,
    files: result.files,
  }
  args.dispatch(env)
  return result.snapshotId
}

export async function startDeltaFiber(args: DeltaFiberArgs): Promise<string | undefined> {
  try {
    const result = await args.requestDiff(args.prevSnapshotHash)
    const env: WorkspaceDeltaCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "workspace_delta_captured",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      seq: args.syncSeq(),
      ts: args.now(),
      agentVersion: args.agentVersion,
      snapshotHash: result.snapshotHash,
      prevSnapshotHash: args.prevSnapshotHash,
      trigger: args.trigger,
      diff: result.diff,
    }
    args.dispatch(env)
    return result.snapshotHash
  } catch (err) {
    console.warn("[session-export] delta capture failed", err)
    return undefined
  }
}

async function resolveBaseline(args: BaselineFiberArgs): Promise<{
  consistency: "stable" | "eventual" | "missing"
  snapshotId?: string
  files: FileEntry[]
}> {
  const pending = args.requestSnapshot()
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), args.timeoutMs))
  try {
    const winner = await Promise.race([pending, timeout])
    if (winner === "timeout") {
      try {
        const eventual = await pending
        return { consistency: "eventual", snapshotId: eventual.snapshotId, files: eventual.files }
      } catch (err) {
        console.warn("[session-export] eventual baseline failed", err)
        return { consistency: "missing", files: [] }
      }
    }
    return { consistency: "stable", snapshotId: winner.snapshotId, files: winner.files }
  } catch (err) {
    console.warn("[session-export] baseline failed", err)
    return { consistency: "missing", files: [] }
  }
}
