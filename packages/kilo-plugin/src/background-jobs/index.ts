export * as KiloBackgroundJobs from "./index"

import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloBackgroundJobsRpc } from "@opencode/schema/kilocode/background-jobs"
import { Effect, Option, Ref, Stream } from "effect"
import { childSession, make } from "./tracker"

/** The core subagent tool. Its job ID is the child session ID. */
const tool = "subagent"

export const Plugin = define({
  id: "kilocode.background-jobs",
  effect: Effect.fn(function* (ctx) {
    // Location services: the supervisor provides them to host plugins, outside the plugin's typed requirements.
    const sessionService = yield* Effect.serviceOption(Session.Service)
    const jobService = yield* Effect.serviceOption(Job.Service)
    if (Option.isNone(sessionService) || Option.isNone(jobService))
      return yield* Effect.die(new Error("Kilo background jobs require location services"))
    const emit = yield* Ref.make<(event: KiloBackgroundJobsRpc.Changed) => Effect.Effect<void>>(() => Effect.void)
    const tracker = yield* make({
      directory: ctx.location.directory,
      jobs: jobService.value,
      sessions: sessionService.value,
      publish: (event) => Effect.flatMap(Ref.get(emit), (publish) => publish(event)),
    })

    const registration = yield* ctx.rpc
      .register(KiloBackgroundJobsRpc.Definition, {
        list: (input) => tracker.list(input.sessionID).pipe(Effect.map((jobs) => ({ jobs }))),
        cancel: (input, context) =>
          tracker
            .cancel(input.jobID)
            .pipe(
              Effect.flatMap((found) =>
                found ? Effect.succeed(true) : Effect.fail(context.error("not_found", "Unknown subagent job")),
              ),
            ),
        promote: (input, context) =>
          tracker
            .promote(input.jobID)
            .pipe(
              Effect.flatMap((result) =>
                result === undefined
                  ? Effect.fail(context.error("not_found", "Unknown subagent job"))
                  : Effect.succeed(result),
              ),
            ),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(emit, (event) => registration.events.emit("changed", event).pipe(Effect.ignore))

    yield* ctx.tool
      .transform((editor) =>
        editor.update(tool, (definition) => {
          const execute = definition.execute
          definition.execute = (input, context) => {
            const started: { id?: Parameters<typeof tracker.background>[0] } = {}
            return execute(input, {
              ...context,
              progress: (update) =>
                Effect.gen(function* () {
                  const child = childSession(update)
                  if (child && started.id === undefined) {
                    started.id = child
                    yield* tracker.start({
                      sessionID: child,
                      parentSessionID: context.sessionID,
                      title: input.description,
                      agent: input.agent,
                      background: input.background === true,
                    })
                  }
                  yield* context.progress(update)
                }),
            }).pipe(
              Effect.tap((result) => {
                if (started.id === undefined) return Effect.void
                // A call that returns while its child still runs started it in the background or was moved there.
                if (result.metadata?.status === "running") return tracker.background(started.id)
                return tracker.finish(started.id, "completed")
              }),
              Effect.tapError((error) => {
                if (started.id === undefined) return Effect.void
                return tracker.fail(started.id, error instanceof Error ? error.message : String(error))
              }),
              // An interrupted call stops its foreground child.
              Effect.onInterrupt(() => (started.id === undefined ? Effect.void : tracker.finish(started.id, "cancelled"))),
            )
          }
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) => tracker.remove(event.data.sessionID)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
