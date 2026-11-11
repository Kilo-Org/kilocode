// The Kilo wakeup plugin: the wakeup and cron tools, and the pending state clients show as `scheduled`. Each task is a
// native schedule with a hook action, claimed here through the schedule hook so this plugin owns the prompt it
// delivers. That keeps buffered timing, restart recovery and multi-process leadership in the native loop.
import { Schedule } from "@opencode/core/schedule"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloWakeupRpc } from "@opencode/schema/kilocode/wakeup"
import { Cause, Effect, Ref, Stream } from "effect"
import { makeService } from "./service"
import { makeTools } from "./tools"

/**
 * The session whose tasks an event retires, or undefined when the event does not affect them. The goal contract publishes
 * `changed` on every write, including clearing the goal as null, so only a goal that is still active keeps the tasks.
 */
export function cleanup(event: { readonly type: string; readonly data: unknown }) {
  const data = event.data as { readonly sessionID?: string; readonly goal?: { readonly status?: string } | null }
  if (data?.sessionID === undefined) return undefined
  if (event.type === "session.deleted") return data.sessionID
  if (event.type !== "rpc.opencode.goal.changed") return undefined
  return data.goal === null || data.goal?.status !== "active" ? data.sessionID : undefined
}

export const KiloWakeupPlugin = define({
  id: "kilocode.wakeup",
  effect: Effect.fn("KiloWakeupPlugin")(function* (ctx) {
    const schedules = yield* Schedule.Service
    const emit = yield* Ref.make<(event: KiloWakeupRpc.Changed) => Effect.Effect<void>>(() => Effect.void)
    const wake = makeService(ctx, schedules, () => (event) =>
      Effect.flatMap(Ref.get(emit), (publish) => publish(event)),
    )
    const registration = yield* ctx.rpc
      .register(KiloWakeupRpc.Definition, {
        list: (input) => wake.list(input.sessionID).pipe(Effect.map((wakeups) => ({ wakeups }))),
        pending: (input) => wake.pending(input.directory).pipe(Effect.map((sessions) => ({ sessions }))),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(emit, (event) => registration.events.emit("changed", event).pipe(Effect.ignore))

    const tools = makeTools(wake)
    yield* ctx.tool
      .transform((editor) => {
        editor.add(tools.wakeup)
        editor.add(tools.cancel)
        editor.add(tools.cronCreate)
        editor.add(tools.cronList)
        editor.add(tools.cronDelete)
      })
      .pipe(Effect.orDie)

    // A due occurrence is ours when the record still exists. `fire` delivers before it retires the record, so a delivery
    // failure keeps the task instead of losing it; only a deleted session drops it.
    yield* ctx.session.hook("experimental.schedule", (event) =>
      wake
        .fire(event.schedule)
        .pipe(
          Effect.tap((ours) =>
            Effect.sync(() => {
              if (ours) event.claimed = true
            }),
          ),
          Effect.asVoid,
        ),
    )

    // A session that goes away, or a goal that finishes, pauses or is cleared, takes its scheduled tasks with it.
    yield* ctx.event
      .subscribe({ types: ["session.deleted", "rpc.opencode.goal.changed"] })
      .pipe(
        Stream.runForEach((event) => {
          const sessionID = cleanup(event)
          if (sessionID === undefined) return Effect.void
          return wake.cancelSession(sessionID).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to cancel the session's scheduled tasks", { sessionID, cause }),
            ),
          )
        }),
        Effect.forkScoped({ startImmediately: true }),
      )

    // Records outlive the process; drop the ones whose native schedule finished while nothing was listening.
    yield* wake.recover(ctx.location.directory).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning("wakeup recovery failed", { cause }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
