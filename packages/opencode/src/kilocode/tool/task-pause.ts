// A user interrupt from a subagent view pauses the task that launched the
// subagent instead of ending it. The child's turn stops, but the task's job
// keeps running and `runTask` waits here, keyed by child session ID, until the
// pause is resumed (the child is directed again and its next turn is awaited) or
// released (the user returned control to the parent without further direction).
//
// Clients read the pause from the child session's metadata (`KEY`), projected
// from this live registry on every session read and update, so a marker
// persisted by a process that died mid-pause is never shown as live.
import { Deferred, Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Database } from "@opencode-ai/core/database/database"
import type { BackgroundJob } from "@/background/job"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { SessionDrain } from "@/kilocode/session/drain"
import { KiloSessionSteering } from "@/kilocode/session/steering"
import { resumeHint } from "@/kilocode/task-resume"

/** Child session metadata key that marks a task paused by the user. Must match the TUI. */
export const KEY = "kilo.task"

export const NOTICE =
  "The user interrupted this subagent; it is paused awaiting their direction. Its result will still be delivered."

export type Signal = "resume" | "release"

type Entry = { done: Deferred.Deferred<Signal>; notice: Effect.Effect<void> }

const pauses = new Map<string, Entry>()
// Tasks whose last run ended because the user released the pause.
const released = new Set<string>()

export function paused(id: string) {
  return pauses.has(id)
}

/** The interrupted task result handed to the parent agent. */
export function text(id: string) {
  return [
    "The user interrupted this subagent and returned control to you without further direction.",
    "Do not redo its work.",
    resumeHint(id),
  ].join(" ")
}

/** Read and clear whether the task's last run was released from a pause. */
export function take(id: string) {
  return released.delete(id)
}

function signal(id: string, value: Signal) {
  return Effect.suspend(() => {
    const entry = pauses.get(id)
    if (!entry) return Effect.succeed(false)
    pauses.delete(id)
    return Deferred.succeed(entry.done, value)
  })
}

/** Return control to the parent: the paused task ends with the interrupted result. */
export const release = (id: string) => signal(id, "release")

/** The paused child was directed again: the task waits for its next turn. */
export const resume = (id: string) => signal(id, "resume")

/** Post the paused notice for a task that is (now) a background task. No-op when not paused. */
export const announce = (id: string) => Effect.suspend(() => pauses.get(id)?.notice ?? Effect.void)

/** Session metadata as clients should see it: the pause marker exactly while the pause is live. */
export function project(id: string, metadata?: Record<string, unknown> | null) {
  if (pauses.has(id)) return { ...metadata, [KEY]: { status: "paused" } }
  if (!metadata || !(KEY in metadata)) return metadata ?? undefined
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== KEY))
}

type Board = { config: Config.Interface; flags: RuntimeFlags.Info; database: Database.Interface }

/**
 * Settle a task run after its prompt to the child returned. An interrupted turn
 * pauses the task instead of waiting on the child's drain, which also holds for
 * background grandchildren that keep running through the interrupt.
 */
export const settle = Effect.fn("KiloTaskPause.settle")(function* (input: {
  child: SessionID
  parent: SessionID
  initial: SessionV1.WithParts
  drain: Pick<SessionDrain.Interface, "wait">
  sessions: Pick<Session.Interface, "messages" | "touch">
  jobs: Pick<BackgroundJob.Interface, "get">
  paused?: (id: SessionID) => Effect.Effect<boolean>
  board: Board
}) {
  released.delete(input.child)
  const latest = Effect.gen(function* () {
    const last = (yield* input.sessions.messages({ sessionID: input.child, limit: 1 })).at(-1)
    return last?.info.role === "assistant" && last.info.id > input.initial.info.id ? last : input.initial
  })
  // Only a user stop pauses the child (`KiloSessionControl.stop`); a provider abort is a failure,
  // and a cancelled job tears the task down instead.
  const check = Effect.gen(function* () {
    const message = yield* latest
    if (message.info.role !== "assistant" || message.info.error?.name !== "MessageAbortedError")
      return { message, interrupted: false }
    if (!input.paused || !(yield* input.paused(input.child))) return { message, interrupted: false }
    const job = yield* input.jobs.get(input.child)
    return { message, interrupted: job?.status === "running" }
  })
  const publish = input.sessions
    .touch(input.child)
    .pipe(Effect.catchCause((cause) => Effect.logDebug("task pause publish failed", { cause })))
  const notice = (messageID: string) =>
    Effect.gen(function* () {
      const job = yield* input.jobs.get(input.child)
      if (job?.status !== "running" || job.metadata?.background !== true) return
      yield* KiloSessionSteering.post({
        from: input.child,
        to: input.parent,
        messageID,
        body: KiloSessionSteering.body(NOTICE, ""),
        ...input.board,
      })
    })
  const hold = (messageID: string) =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const entry = { done: yield* Deferred.make<Signal>(), notice: notice(messageID) }
        pauses.set(input.child, entry)
        yield* publish
        yield* entry.notice
        return entry
      }),
      (entry) => Deferred.await(entry.done),
      (entry) =>
        Effect.gen(function* () {
          if (pauses.get(input.child) === entry) pauses.delete(input.child)
          yield* publish
        }),
    )

  let state = yield* check
  while (true) {
    if (!state.interrupted) {
      yield* input.drain.wait(input.child)
      state = yield* check
      if (!state.interrupted) return state
    }
    if ((yield* hold(state.message.info.id)) === "release") {
      released.add(input.child)
      return state
    }
    state = { message: state.message, interrupted: false }
  }
})

export * as KiloTaskPause from "./task-pause"
