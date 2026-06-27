import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { Effect } from "effect"
import { KiloPartLifecycle } from "./part-lifecycle"

const task = "task"
const stale = /^[ \t]*task_id:[^\r\n]*(?:(?:\r?\n){1,2}|$)/m

type Item = { type: "message"; info: MessageV2.Info } | { type: "part"; part: MessageV2.Part; time: number }

export function writer(sessionID: SessionID, sync: SyncEvent.Interface) {
  const items: Item[] = []
  return {
    message<T extends MessageV2.Info>(info: T) {
      items.push({ type: "message", info })
      return info
    },
    part(part: MessageV2.Part) {
      if (KiloPartLifecycle.transient(part)) return
      items.push({ type: "part", part: structuredClone(detachPart(part)), time: Date.now() })
    },
    commit() {
      return Effect.sync(() =>
        Database.transaction(
          () => {
            // sync.run stays synchronous with publishing disabled, and its nested transaction reuses this active transaction.
            for (const item of items) {
              if (item.type === "message") {
                Effect.runSync(sync.run(MessageV2.Event.Updated, { sessionID, info: item.info }, { publish: false }))
                continue
              }
              Effect.runSync(
                sync.run(
                  MessageV2.Event.PartUpdated,
                  { sessionID, part: item.part, time: item.time },
                  { publish: false },
                ),
              )
            }
          },
          { behavior: "immediate" },
        ),
      )
    },
  }
}

function metadata(value: Record<string, unknown> | undefined) {
  if (!value) return value
  const copy = { ...value }
  delete copy.sessionId
  delete copy.sessionID
  return copy
}

function input(value: Record<string, unknown>) {
  const copy = { ...value }
  delete copy.task_id
  return copy
}

/**
 * Turns copied task calls into detached historical results.
 *
 * Child sessions are execution state, not conversation context. Their final
 * result is already embedded in the parent task part, so a fork keeps that
 * result while dropping references that could resume, stream, or route prompts
 * to a child owned by the source session.
 */
function detachPart(part: MessageV2.Part): MessageV2.Part {
  if (part.type !== "tool" || part.tool !== task) return part

  const top = metadata(part.metadata)
  const state = part.state
  if (state.status === "pending") {
    const now = Date.now()
    return {
      ...part,
      metadata: top,
      state: {
        status: "error",
        input: input(state.input),
        error: "Task was still pending when this session was forked.",
        time: { start: now, end: now },
      },
    }
  }

  if (state.status === "running") {
    return {
      ...part,
      metadata: top,
      state: {
        status: "error",
        input: input(state.input),
        error: "Task was still running when this session was forked.",
        metadata: metadata(state.metadata),
        time: { start: state.time.start, end: Date.now() },
      },
    }
  }

  if (state.status === "error") {
    return {
      ...part,
      metadata: top,
      state: {
        ...state,
        input: input(state.input),
        metadata: metadata(state.metadata),
      },
    }
  }

  return {
    ...part,
    metadata: top,
    state: {
      ...state,
      input: input(state.input),
      output: state.output.replace(stale, ""),
      metadata: metadata(state.metadata) ?? {},
    },
  }
}
