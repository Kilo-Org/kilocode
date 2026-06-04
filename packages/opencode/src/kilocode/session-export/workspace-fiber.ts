import type {
  CaptureMetadata,
  DeltaEntry,
  ExportEvent,
  FileEntry,
  WorkspaceBaselineCompleted,
  WorkspaceDeltaCaptured,
} from "./events"
import { ulid } from "ulid"

export type BaselineFiberArgs = {
  sessionId: string
  rootSessionId: string
  turnId?: string
  timeoutMs: number
  now: () => number
  syncSeq: () => number
  agentVersion: string
  requestSnapshot: () => Promise<{ snapshotId: string; files: FileEntry[]; capture?: CaptureMetadata }>
  dispatch: (envelope: ExportEvent) => void
}

export type DeltaFiberArgs = {
  sessionId: string
  rootSessionId: string
  turnId?: string
  trigger: "next_request" | "turn_end" | "session_close"
  prevSnapshotHash: string
  now: () => number
  syncSeq: () => number
  agentVersion: string
  requestDiff: (prevSnapshotHash: string) => Promise<{ snapshotHash: string; diff: DeltaEntry[] }>
  dispatch: (envelope: ExportEvent) => void
}

export async function startBaselineFiber(args: BaselineFiberArgs): Promise<string | undefined> {
  const result = await resolveBaseline(args)
  emitBaseline(args, result)
  return result.snapshotId
}

function emitBaseline(
  args: BaselineFiberArgs,
  result: {
    consistency: "stable" | "eventual" | "missing"
    snapshotId?: string
    files: FileEntry[]
    capture?: CaptureMetadata
  },
): void {
  const seq = args.syncSeq()
  args.dispatch({
    id: ulid(),
    schemaVersion: 1,
    type: "workspace_baseline_completed",
    sessionId: args.sessionId,
    rootSessionId: args.rootSessionId,
    turnId: args.turnId,
    seq,
    eventSeq: seq,
    ts: args.now(),
    agentVersion: args.agentVersion,
    snapshotId: result.snapshotId,
    consistency: result.consistency,
    files: result.files,
    capture: result.capture,
  })
}

export async function startDeltaFiber(args: DeltaFiberArgs): Promise<string | undefined> {
  try {
    const result = await args.requestDiff(args.prevSnapshotHash)
    if (result.diff.length === 0) return result.snapshotHash
    const seq = args.syncSeq()
    const env: WorkspaceDeltaCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "workspace_delta_captured",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      turnId: args.turnId,
      seq,
      eventSeq: seq,
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
  capture?: CaptureMetadata
}> {
  const pending = args.requestSnapshot()
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), args.timeoutMs))
  try {
    const winner = await Promise.race([pending, timeout])
    if (winner === "timeout") {
      void pending.then(
        (eventual) =>
          emitBaseline(args, {
            consistency: "eventual",
            snapshotId: eventual.snapshotId,
            files: eventual.files,
            capture: eventual.capture,
          }),
        (err) => console.warn("[session-export] eventual baseline failed", err),
      )
      return { consistency: "missing", files: [] }
    }
    return { consistency: "stable", snapshotId: winner.snapshotId, files: winner.files, capture: winner.capture }
  } catch (err) {
    console.warn("[session-export] baseline failed", err)
    return { consistency: "missing", files: [] }
  }
}
