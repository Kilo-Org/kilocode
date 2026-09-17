import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { testEffect } from "../lib/effect"

const it = testEffect(SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer)))

describe("SessionStatus idle publication", () => {
  for (const failure of [undefined, SessionStatus.Event.Status.type, SessionStatus.Event.Idle.type]) {
    it.instance(
      failure
        ? `keeps both stores cleared when ${failure} publication fails`
        : "clears both stores before idle publication",
      () =>
        Effect.gen(function* () {
          const status = yield* SessionStatus.Service
          const events = yield* EventV2Bridge.Service
          const id = SessionID.make(`ses_idle_publication_${failure ?? "success"}`)
          const error = new Error("deliberate publication failure")
          const observed: { type: string; local: boolean; global: boolean }[] = []

          yield* status.set(id, { type: "busy" })
          expect((yield* status.list()).get(id)).toEqual({ type: "busy" })
          expect((yield* SessionStatus.listAll()).get(id)).toEqual({ type: "busy" })

          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== SessionStatus.Event.Status.type && event.type !== SessionStatus.Event.Idle.type) return
              observed.push({
                type: event.type,
                local: (yield* status.list()).has(id),
                global: (yield* SessionStatus.listAll()).has(id),
              })
              if (event.type === failure) yield* Effect.die(error)
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)

          const exit = yield* status.set(id, { type: "idle" }).pipe(Effect.exit)

          expect(Exit.isFailure(exit)).toBe(failure !== undefined)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(error)
          expect(observed).toEqual(
            (failure === SessionStatus.Event.Status.type
              ? [SessionStatus.Event.Status.type]
              : [SessionStatus.Event.Status.type, SessionStatus.Event.Idle.type]
            ).map((type) => ({ type, local: false, global: false })),
          )
          expect((yield* status.list()).has(id)).toBe(false)
          expect((yield* SessionStatus.listAll()).has(id)).toBe(false)
        }),
    )
  }
})
