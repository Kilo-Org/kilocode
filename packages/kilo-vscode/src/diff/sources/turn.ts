import type { FileDiffInfo } from "@opencode/client"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "./types"
import type { GeneratedFiles } from "../shared/git-attributes"
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
 * Fetches the file diffs of one turn. The v2 session diff takes the user
 * message whose turn to diff as `from`, so a turn reads the range that starts
 * at its own message.
 */
export type TurnDiffFetch = (params: { sessionID: string; messageID: string }) => Promise<FileDiffInfo[]>

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
  generated?: GeneratedFiles,
): DiffSource {
  return {
    descriptor: turnDescriptor(sessionId, messageId),

    async fetch(): Promise<DiffSourceFetch> {
      const raw = await fetch({ sessionID: sessionId, messageID: messageId })
      const configured = generated ? await generated(raw.map((file) => file.file)) : undefined
      return { diffs: raw.map((file) => toSessionDiffFile(file, configured)), stopPolling: true }
    },
  }
}