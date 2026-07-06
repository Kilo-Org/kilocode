import { createHash } from "crypto"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import { normalize, text } from "@kilocode/kilo-ui/session-diff"
import { encodeImageSide, imageMime } from "../shared/image"
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
  let cache: { key: string; diffs: DiffFile[] } | undefined

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
      const key = raw.map(fingerprint).join("|")
      if (cache?.key === key) return { diffs: cache.diffs }
      const diffs = raw.map(toSessionDiffFile)
      cache = { key, diffs }
      return { diffs }
    },
  }
}

function fingerprint(raw: SnapshotFileDiff): string {
  const patch = createHash("sha1")
    .update(raw.patch ?? "")
    .digest("hex")
  return [raw.file, raw.status, raw.additions, raw.deletions, patch].join(":")
}

/**
 * Project a backend `SnapshotFileDiff` onto the `DiffFile` shape the viewer
 * expects. Shared with `createTurnDiffSource` since both hit the same endpoint.
 */
export function toSessionDiffFile(raw: SnapshotFileDiff): DiffFile {
  const file = raw.file ?? ""
  const mime = imageMime(file)
  // Empty patch means binary or summarized (>256 KB) — normalize() can't
  // parse it, so short-circuit to empty strings. Binary snapshot images do
  // not retain their sides, while text-backed SVG patches can be rebuilt.
  const view = raw.patch === "" || (mime && mime !== "image/svg+xml") ? null : normalize(raw)
  const before = view ? text(view, "deletions") : ""
  const after = view ? text(view, "additions") : ""
  const image = (() => {
    if (mime === "image/svg+xml" && view) {
      return {
        before: raw.status === "added" ? undefined : encodeImageSide(mime, Buffer.from(before)),
        after: raw.status === "deleted" ? undefined : encodeImageSide(mime, Buffer.from(after)),
      }
    }
    if (mime) return {}
    return undefined
  })()
  return {
    file,
    before: mime ? "" : before,
    after: mime ? "" : after,
    patch: mime ? "" : raw.patch,
    additions: raw.additions,
    deletions: raw.deletions,
    status: raw.status,
    tracked: true,
    generatedLike: false,
    // A zero-stat empty patch has no text body to fetch; nonzero stats
    // indicate a deferred large-file summary.
    summarized: !mime && raw.patch === "" && (raw.additions !== 0 || raw.deletions !== 0),
    kind: mime ? "image" : undefined,
    image,
    stamp: mime ? fingerprint(raw) : undefined,
  }
}
