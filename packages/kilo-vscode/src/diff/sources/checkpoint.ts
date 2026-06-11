import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import { toSessionDiffFile } from "./session"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"

export const CHECKPOINT_PREFIX = "checkpoint:"

export function checkpointSourceId(sessionID: string, messageID: string, partID: string) {
  return `${CHECKPOINT_PREFIX}${sessionID}:${messageID}:${partID}`
}

export function checkpointDescriptor(sessionID: string, messageID: string, partID: string): DiffSourceDescriptor {
  return {
    id: checkpointSourceId(sessionID, messageID, partID),
    type: "turn",
    group: "Session",
    capabilities: { revert: false, comments: true },
  }
}

export type CheckpointDiffFetch = (input: {
  sessionID: string
  messageID: string
  partID: string
  directory?: string
}) => Promise<SnapshotFileDiff[]>

export function createCheckpointDiffSource(
  sessionID: string,
  messageID: string,
  partID: string,
  fetch: CheckpointDiffFetch,
  directory?: string,
): DiffSource {
  return {
    descriptor: checkpointDescriptor(sessionID, messageID, partID),
    async fetch(): Promise<DiffSourceFetch> {
      const diffs = await fetch({ sessionID, messageID, partID, directory })
      return { diffs: diffs.map(toSessionDiffFile), stopPolling: true }
    },
  }
}
