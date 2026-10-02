// A user interrupt from a subagent view pauses the task that launched the
// subagent instead of ending it. The child's turn stops, but the task's job
// keeps running and `runTask` waits here, keyed by child session ID, until a
// new prompt to the child resumes it; the task then awaits that turn. A task
// works until it completes: only cancelling its job (a `tree` abort of the
// child, deleting it, or disposing the instance) ends a paused task early.
//
// Clients read the pause from the child session's metadata (`KEY`), projected
// from the live registry in ./task-pause-state on every session read and
// update, so a marker persisted by a process that died mid-pause is never shown.
import { Cause, Context, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Database } from "@opencode-ai/core/database/database"
import type { BackgroundJob } from "@/background/job"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import type { SessionDrain } from "@/kilocode/session/drain"
import { KiloSubagentNotice } from "@/kilocode/board/subagent-notice"
import { KiloTaskPauseState as State } from "./task-pause-state"

export const KEY = State.KEY
export const paused = State.paused
export const announce = State.announce

export const NOTICE =
  "The user interrupted this subagent; it is paused awaiting their direction. Its result will still be delivered."

// The child whose task run only delivers a prompt to a paused task; the paused run awaits the
// turn. Keyed by child ID: the delivered turn inherits this fiber's context, so a boolean would
// also detach every nested task that turn starts.
const Detached = Context.Reference<string | undefined>("~kilo/TaskPauseDetached", { defaultValue: () => undefined })

type Paused = (id: SessionID) => Effect.Effect<boolean>

/**
 * `BackgroundJob.extend` for the task tool. A paused task's job is still running, so `extend`
 * would queue behind the pause forever. Instead, `direct` (the task run) sends the prompt to the
 * child: its admission resumes the paused run, which awaits that turn and delivers the result
 * through the original job. The detached run returns without waiting.
 *
 * A child stopped by the user whose task has not reached its pause yet takes the same path, so a
 * `task_id` that lands between the interrupt and the pause cannot queue behind it.
 */
export const extend = Effect.fn("KiloTaskPause.extend")(function* <E, R>(
  input: {
    jobs: Pick<BackgroundJob.Interface, "extend" | "get">
    direct: Effect.Effect<unknown, E, R>
    paused?: Paused
    scope: Scope.Scope
  },
  job: Parameters<BackgroundJob.Interface["extend"]>[0],
) {
  const id = SessionID.make(job.id)
  const waiting =
    State.paused(id) ||
    (input.paused !== undefined && (yield* input.paused(id)) && (yield* input.jobs.get(id))?.status === "running")
  if (!waiting) return yield* input.jobs.extend(job)
  // Report success only once the child admitted the prompt: a run that fails before then
  // resumed nothing, so the caller gets that failure instead of "sent".
  const admitted = yield* Deferred.make<void>()
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => State.watch(id, admitted)),
    () =>
      Effect.gen(function* () {
        const fiber = yield* input.direct.pipe(
          Effect.provideService(Detached, id),
          Effect.tapCause((cause) => Effect.logWarning("paused task prompt failed", { cause })),
          Effect.forkIn(input.scope, { startImmediately: true }),
        )
        const sent = Fiber.await(fiber).pipe(
          Effect.flatMap((exit) =>
            Exit.isSuccess(exit)
              ? Effect.succeed(true)
              : Effect.fail(new Error(`The prompt did not reach the paused task: ${Cause.pretty(exit.cause)}`)),
          ),
        )
        return yield* Effect.raceFirst(Deferred.await(admitted).pipe(Effect.as(true)), sent)
      }),
    (unwatch) => Effect.sync(unwatch),
  )
})

type Board = { config: Config.Interface; flags: RuntimeFlags.Info; database: Database.Interface }

type Check = { message: SessionV1.WithParts; interrupted: boolean }

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
  paused?: Paused
  board: Board
}) {
  if ((yield* Detached) === input.child) return input.initial
  const stopped = Effect.suspend(() => (input.paused ? input.paused(input.child) : Effect.succeed(false)))
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
    if (!(yield* stopped)) return { message, interrupted: false }
    const job = yield* input.jobs.get(input.child)
    return { message, interrupted: job?.status === "running" } satisfies Check
  })
  const publish = input.sessions
    .touch(input.child)
    .pipe(Effect.catchCause((cause) => Effect.logDebug("task pause publish failed", { cause })))
  const notice = (messageID: string) =>
    Effect.gen(function* () {
      const job = yield* input.jobs.get(input.child)
      if (job?.status !== "running" || job.metadata?.background !== true) return
      yield* KiloSubagentNotice.post({
        from: input.child,
        to: input.parent,
        messageID,
        body: NOTICE,
        label: "subagent pause notice failed",
        ...input.board,
      })
    })
  // Registration is the only acquire step, so the release always unregisters; the notice and
  // the publish run in `use`, and the marker is published last so it implies the notice ran.
  const hold = (messageID: string) =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const entry = {
          done: yield* Deferred.make<void>(),
          notice: notice(messageID).pipe(
            Effect.catchCause((cause) => Effect.logWarning("subagent pause notice failed", { cause })),
          ),
        }
        State.set(input.child, entry)
        return entry
      }),
      (entry) =>
        Effect.gen(function* () {
          // A prompt admitted between the check and the registration found no pause to resume;
          // it already cleared the stop, so the task resumes right away.
          if (!(yield* stopped)) return
          yield* entry.notice
          yield* publish
          yield* Deferred.await(entry.done)
        }),
      (entry) =>
        Effect.gen(function* () {
          State.remove(input.child, entry)
          yield* publish
        }),
    )

  // Wait for the child's work, pausing whenever its turn ended in a user interrupt.
  const run = (state: Check): Effect.Effect<SessionV1.WithParts, Effect.Error<typeof check>> =>
    Effect.gen(function* () {
      if (state.interrupted) {
        yield* hold(state.message.info.id)
        return yield* run({ message: state.message, interrupted: false })
      }
      yield* input.drain.wait(input.child)
      const next = yield* check
      if (!next.interrupted) return next.message
      return yield* run(next)
    })
  return yield* run(yield* check)
})

export * as KiloTaskPause from "./task-pause"
