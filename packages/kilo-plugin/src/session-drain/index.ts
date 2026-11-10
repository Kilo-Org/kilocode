export * as KiloSessionDrain from "./index"

import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloSessionDrainRpc } from "@opencode/schema/kilocode/session-drain"
import { Effect, Option, Ref } from "effect"
import { make } from "./drain"

export const Plugin = define({
  id: "kilocode.session-drain",
  effect: Effect.fn(function* (ctx) {
    // Global services: the supervisor provides them to host plugins, outside the plugin's typed requirements.
    const sessions = yield* Effect.serviceOption(Session.Service)
    const jobs = yield* Effect.serviceOption(Job.Service)
    if (Option.isNone(sessions) || Option.isNone(jobs))
      return yield* Effect.die(new Error("Kilo session drain requires the session and job services"))
    const drain = make({ sessions: sessions.value, jobs: jobs.value })
    const emit = yield* Ref.make<(event: KiloSessionDrainRpc.Drained) => Effect.Effect<void>>(() => Effect.void)

    const registration = yield* ctx.rpc
      .register(KiloSessionDrainRpc.Definition, {
        drain: (input, context) =>
          drain.wait(input.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", () => Effect.fail(context.error("not_found", "Unknown session"))),
            Effect.andThen(() => {
              const token = input.token
              if (token === undefined) return Effect.void
              return Effect.flatMap(Ref.get(emit), (publish) => publish({ sessionID: input.sessionID, token }))
            }),
            Effect.as(true),
          ),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(emit, (event) => registration.events.emit("drained", event).pipe(Effect.orDie))
  }),
})
