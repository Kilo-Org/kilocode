// A user interrupt from a subagent view pauses the task that launched the
// subagent instead of ending it. The child's turn stops, but the task's job
// keeps running and `runTask` waits here, keyed by child session ID, until a
// new prompt to the child resumes it; the task then awaits that turn. A task
// works until it completes: only cancelling its job (a `tree` abort of the
// child, deleting it, or disposing the instance) ends a paused task early.
//
// Clients read the pause from the child session's metadata (`KEY`), projected
// from this live registry on every session read and update, so a marker
// persisted by a process that died mid-pause is never shown as live.
import { Context, Deferred, Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Database } from "@opencode-ai/core/database/database"
import type { BackgroundJob } from "@/background/job"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { SessionDrain } from "@/kilocode/session/drain"
import { KiloSessionSteering } from "@/kilocode/session/steering"

/** Child session metadata key that marks a task paused by the user. Must match the TUI. */
export const KEY = "kilo.task"

export const NOTICE =
  "The user interrupted this subagent; it is paused awaiting their direction. Its result will still be delivered."

type Entry = { done: Deferred.Deferred<void>; notice: Effect.Effect<void> }

const pauses = new Map<string, Entry>()
// Settling task runs by child. A resume that arrives while a run is between its interrupted check
// and registering its pause is marked here, so the pause it was meant for does not wait forever.
const watching = new Map<string, { missed: boolean }>()

export function paused(id: string) {
  return pauses.has(id)
}

/** The paused child was directed again: the task waits for its next turn. */
export const resume = (id: string) =>
  Effect.suspend(() => {
    const entry = pauses.get(id)
    if (!entry) {
      const watch = watching.get(id)
      if (watch) watch.missed = true
      return Effect.succeed(false)
    }
    pauses.delete(id)
    return Deferred.succeed(entry.done, undefined)
  })

// A run that only delivers a prompt to a paused task's child; the paused run awaits the turn.
export const Detached = Context.Reference<boolean>("~kilo/TaskPauseDetached", { defaultValue: () => false })

/**
 * `BackgroundJob.extend` for the task tool. A paused task's job is still running, so `extend`
 * would queue behind the pause forever. Instead, `direct` (the task run) sends the prompt to the
 * child: its admission resumes the paused run, which awaits that turn and delivers the result
 * through the original job. The detached run returns without waiting.
 */
export const extend = Effect.fn("KiloTaskPause.extend")(function* <E, R>(
  jobs: Pick<BackgroundJob.Interface, "extend">,
  direct: Effect.Effect<unknown, E, R>,
  input: Parameters<BackgroundJob.Interface["extend"]>[0],
) {
  if (!pauses.has(input.id)) return yield* jobs.extend(input)
  yield* direct.pipe(
    Effect.provideService(Detached, true),
    Effect.catchCause((cause) => Effect.logWarning("paused task prompt failed", { cause })),
    Effect.forkDetach({ startImmediately: true }),
  )
  return true
})

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
  if (yield* Detached) return { message: input.initial, paused: false }
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
        const entry = { done: yield* Deferred.make<void>(), notice: notice(messageID) }
        pauses.set(input.child, entry)
        // a prompt admitted after the check already resumed this pause: do not wait for another
        if (watch.missed) {
          pauses.delete(input.child)
          yield* Deferred.succeed(entry.done, undefined)
          return entry
        }
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

  // `paused` reports whether the task paused at any point, so its result can say the user redirected it.
  // `missed` is cleared right before each check: a prompt admitted earlier is awaited by the drain
  // wait, and one admitted after it either finds the pause or is caught by `hold`.
  const watch = { missed: false }
  watching.set(input.child, watch)
  return yield* Effect.gen(function* () {
    let state = yield* check
    let held = false
    while (true) {
      if (!state.interrupted) {
        yield* input.drain.wait(input.child)
        watch.missed = false
        state = yield* check
        if (!state.interrupted) return { message: state.message, paused: held }
      }
      held = true
      yield* hold(state.message.info.id)
      state = { message: state.message, interrupted: false }
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (watching.get(input.child) === watch) watching.delete(input.child)
      }),
    ),
  )
})

export * as KiloTaskPause from "./task-pause"
