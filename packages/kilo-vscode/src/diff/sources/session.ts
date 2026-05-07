import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import { normalize, text } from "@kilocode/kilo-ui/session-diff"
import type { DiffFile } from "../types"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"

export type SessionDiffFetch = (params: { sessionID: string; directory?: string }) => Promise<SnapshotFileDiff[]>

export type SnapshotEnabledCheck = (directory?: string) => Promise<boolean>

export const SESSION_PREFIX = "session:"

export function sessionSourceId(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`
}

export function sessionDescriptor(sessionId: string): DiffSourceDescriptor {
  return {
    id: sessionSourceId(sessionId),
    type: "session",
    group: "Session",
    capabilities: { revert: false, comments: true },
  }
}

/**
 * Diff for the current session. Returns file diffs from the SDK's session
 * snapshot endpoint, or a `snapshots-disabled` notice if snapshotting is
 * turned off in the workspace config (in which case the controller stops
 * polling because repeated fetches can't surface new data).
 */
export function createSessionDiffSource(
  sessionId: string,
  fetch: SessionDiffFetch,
  workspaceRoot?: string,
  checkSnapshotsEnabled?: SnapshotEnabledCheck,
): DiffSource {
  // Cached across fetches so subsequent polling ticks skip the config lookup.
  let snapshotsDisabled = false

  return {
    descriptor: sessionDescriptor(sessionId),

    async fetch(): Promise<DiffSourceFetch> {
      if (snapshotsDisabled) {
        return { diffs: [], notice: "snapshots-disabled", stopPolling: true }
      }

      if (checkSnapshotsEnabled) {
        const enabled = await checkSnapshotsEnabled(workspaceRoot)
        if (!enabled) {
          snapshotsDisabled = true
          return { diffs: [], notice: "snapshots-disabled", stopPolling: true }
        }
      }

      const raw = await fetch({ sessionID: sessionId, directory: workspaceRoot })
      return { diffs: raw.map(toSessionDiffFile) }
    },
  }
}

/**
 * Project a backend `SnapshotFileDiff` onto the `DiffFile` shape the viewer
 * expects. Shared with `createTurnDiffSource` since both hit the same endpoint.
 */
export function toSessionDiffFile(raw: SnapshotFileDiff): DiffFile {
  // Empty patch means binary or summarized (>256 KB) — normalize() can't
  // parse it, so short-circuit to empty strings.
  const view = raw.patch === "" ? null : normalize(raw)
  return {
    file: raw.file,
    before: view ? text(view, "deletions") : "",
    after: view ? text(view, "additions") : "",
    additions: raw.additions,
    deletions: raw.deletions,
    status: raw.status,
    tracked: true,
    generatedLike: false,
    summarized: raw.patch === "",
  }
}
