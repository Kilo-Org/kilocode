import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"
import { toSessionDiffFile } from "./session"

export const TURN_PREFIX = "turn:"

export function turnSourceId(sessionId: string, messageId: string): string {
  return `${TURN_PREFIX}${sessionId}:${messageId}`
}

export function turnDescriptor(sessionId: string, messageId: string): DiffSourceDescriptor {
  return {
    id: turnSourceId(sessionId, messageId),
    type: "turn",
    // Group is irrelevant here because turn sources only open in hide-picker
    // mode; the picker never renders them. Default to "Session" for cohesion.
    group: "Session",
    capabilities: { revert: false, comments: true },
  }
}

/**
 * Fetches the per-turn diffs attached to a user message. The session-level
 * `/session/:id/diff` endpoint ignores `messageID`, so the per-turn view has
 * to read from the message's own `summary.diffs`.
 */
export type TurnDiffFetch = (params: {
  sessionID: string
  messageID: string
  directory?: string
}) => Promise<SnapshotFileDiff[]>

/**
 * Static diff for a single turn (the file changes attributed to one user
 * message). Returns `stopPolling: true` so the controller runs `fetch` once
 * and never schedules a polling tick — a completed turn's snapshot doesn't
 * change.
 */
export function createTurnDiffSource(
  sessionId: string,
  messageId: string,
  fetch: TurnDiffFetch,
  workspaceRoot?: string,
): DiffSource {
  return {
    descriptor: turnDescriptor(sessionId, messageId),

    async fetch(): Promise<DiffSourceFetch> {
      const raw = await fetch({ sessionID: sessionId, messageID: messageId, directory: workspaceRoot })
      return { diffs: raw.map(toSessionDiffFile), stopPolling: true }
    },
  }
}
