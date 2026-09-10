import type { OpenCodeClient } from "@opencode-ai/client"
import type { RemoteOutbound } from "./remote-protocol"

/**
 * Legacy v1 session status / rename / queue translation for the remote relay.
 *
 * Status, retry, error and rename frames are a pure mapping over the durable v2
 * payloads:
 *
 * - session.execution.started            → session.status busy
 * - session.execution.succeeded|failed|interrupted → session.status idle +
 *   session.idle (failed additionally emits session.error)
 * - session.retry.scheduled              → session.status retry
 * - session.renamed                      → session.updated
 *
 * The queue lane is different: `session.queue.changed` is an authoritative FIFO
 * snapshot the consumer reconciles against wholesale, so every emitted frame is
 * a fresh read of the public pending inbox projection
 * (`session.inbox.list`, ordered by enqueue sequence, pending rows only). Inbox
 * events act as invalidations, never as the data — no local list is ever
 * extended, truncated, or replayed as if it were the full queue, so a fresh
 * adapter, a restarted host, and an item enqueued by another client all
 * advertise the same ids.
 *
 * Queue ids are the pending user inbox item ids (SessionMessage.ID, the same
 * msg_ identifier family v1's queue snapshot published, and the id
 * `session.inbox.cancel` accepts). Non-user inbox work (synthetic, compaction,
 * move) is never advertised.
 */

export type StatusFrame = Extract<RemoteOutbound, { type: "event" }>

export interface RemoteStatusState {
  /**
   * Last advertised FIFO per session. Only two jobs: suppress duplicate frames
   * when an invalidation did not change the user queue, and give the tests a
   * seam. It is never read as the queue itself.
   */
  readonly advertised: Map<string, string[]>
  /**
   * Highest applied read ticket per session. A read that resolves after a newer
   * read already applied is dropped, so an overtaken snapshot never becomes the
   * consumer's latest reconciliation.
   */
  readonly applied: Map<string, number>
  readonly ticket: { current: number }
}

export function createRemoteStatus(): RemoteStatusState {
  return { advertised: new Map(), applied: new Map(), ticket: { current: 0 } }
}

/** Drop a session's advertise bookkeeping on unsubscribe; both maps move together. */
export function forgetSession(state: RemoteStatusState, sessionID: string): void {
  state.advertised.delete(sessionID)
  state.applied.delete(sessionID)
}

function frame(sessionId: string, event: string, data: unknown): StatusFrame {
  return { type: "event", sessionId, event, data }
}

export function statusFrames(event: { type: string; data: unknown }): StatusFrame[] {
  switch (event.type) {
    case "session.execution.started": {
      const payload = event.data as { sessionID: string }
      return [frame(payload.sessionID, "session.status", { sessionID: payload.sessionID, status: { type: "busy" } })]
    }
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      const payload = event.data as { sessionID: string }
      return [
        frame(payload.sessionID, "session.status", { sessionID: payload.sessionID, status: { type: "idle" } }),
        frame(payload.sessionID, "session.idle", { sessionID: payload.sessionID }),
      ]
    }
    case "session.execution.failed": {
      const payload = event.data as {
        sessionID: string
        error: { type: string; message: string }
      }
      return [
        frame(payload.sessionID, "session.status", { sessionID: payload.sessionID, status: { type: "idle" } }),
        frame(payload.sessionID, "session.idle", { sessionID: payload.sessionID }),
        frame(payload.sessionID, "session.error", {
          sessionID: payload.sessionID,
          error: { name: payload.error.type, data: { message: payload.error.message } },
        }),
      ]
    }
    case "session.retry.scheduled": {
      const payload = event.data as {
        sessionID: string
        attempt: number
        at: number
        error: { message: string }
      }
      return [
        frame(payload.sessionID, "session.status", {
          sessionID: payload.sessionID,
          status: { type: "retry", attempt: payload.attempt, message: payload.error.message, next: payload.at },
        }),
      ]
    }
    case "session.renamed": {
      const payload = event.data as { sessionID: string; title: string }
      return [frame(payload.sessionID, "session.updated", { info: { id: payload.sessionID, title: payload.title } })]
    }
    default:
      return []
  }
}

/**
 * Which inbox events invalidate the advertised queue. `enqueued` carries the
 * item type so non-user work is ignored without a read; `delivered` and
 * `cancelled` do not, so they always re-read and rely on the unchanged-snapshot
 * check to stay quiet when the consumed item was synthetic, compaction or move
 * work.
 */
export function invalidatesQueue(event: { type: string; data: unknown }): boolean {
  if (event.type === "session.inbox.delivered" || event.type === "session.inbox.cancelled") return true
  if (event.type !== "session.inbox.enqueued") return false
  const payload = event.data as { item?: { type?: string } }
  return payload.item?.type === "user"
}

export async function pendingUserQueue(
  client: Pick<OpenCodeClient, "session">,
  sessionID: string,
): Promise<string[] | undefined> {
  if (!client.session.inbox) return undefined
  const listed = await client.session.inbox.list({ sessionID }).catch(() => undefined)
  if (listed === undefined) return undefined
  return listed.filter((item) => item.type === "user").map((item) => item.id)
}

const sameQueue = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * Read the authoritative pending queue and advertise it. `always` forces the
 * frame even when the snapshot is unchanged, which is what subscribe and
 * reconnect replay need: the consumer treats every frame as a full
 * reconciliation and has no state of its own after a reconnect.
 */
async function advertise(
  state: RemoteStatusState,
  client: Pick<OpenCodeClient, "session">,
  sessionID: string,
  isActive: () => boolean,
  always: boolean,
): Promise<StatusFrame[]> {
  if (!isActive()) return []
  const ticket = (state.ticket.current += 1)
  const queued = await pendingUserQueue(client, sessionID)
  if (queued === undefined || !isActive()) return []
  // A newer read already applied: this snapshot is behind the consumer's view.
  if ((state.applied.get(sessionID) ?? 0) > ticket) return []
  state.applied.set(sessionID, ticket)
  const previous = state.advertised.get(sessionID)
  state.advertised.set(sessionID, queued)
  if (!always && previous !== undefined && sameQueue(previous, queued)) return []
  return [frame(sessionID, "session.queue.changed", { sessionID, queued })]
}

/** Live invalidation: re-read the pending queue and advertise it when it changed. */
export function queueFrames(
  state: RemoteStatusState,
  client: Pick<OpenCodeClient, "session">,
  sessionID: string,
  isActive: () => boolean,
): Promise<StatusFrame[]> {
  return advertise(state, client, sessionID, isActive, false)
}

/** Subscribe/reconnect replay: always reconcile, even when nothing changed. */
export function queueReplayFrames(
  state: RemoteStatusState,
  client: Pick<OpenCodeClient, "session">,
  sessionID: string,
  isActive: () => boolean,
): Promise<StatusFrame[]> {
  return advertise(state, client, sessionID, isActive, true)
}
