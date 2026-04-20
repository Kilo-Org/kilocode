import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { makeRuntime } from "@/effect/run-service" // kilocode_change
import { Effect, Layer, Context } from "effect"
import z from "zod"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
      // kilocode_change start
      z.object({
        type: z.literal("offline"),
        requestID: z.string(),
        message: z.string(),
      }),
      // kilocode_change end
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  export interface Interface {
    readonly get: (sessionID: SessionID) => Effect.Effect<Info>
    readonly list: () => Effect.Effect<Map<SessionID, Info>>
    readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const state = yield* InstanceState.make(
        Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
      )

      const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        return data.get(sessionID) ?? { type: "idle" as const }
      })

      const list = Effect.fn("SessionStatus.list")(function* () {
        return new Map(yield* InstanceState.get(state))
      })

      const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
        const data = yield* InstanceState.get(state)
        yield* bus.publish(Event.Status, { sessionID, status })
        if (status.type === "idle") {
          yield* bus.publish(Event.Idle, { sessionID })
          data.delete(sessionID)
          return
        }
        data.set(sessionID, status)
      })

      return Service.of({ get, list, set })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

  // kilocode_change start - legacy promise helpers for Kilo callsites
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const list = () => runPromise((svc) => svc.list())
  export const get = (sessionID: SessionID) => runPromise((svc) => svc.get(sessionID))
  export const set = (sessionID: SessionID, status: Info) => runPromise((svc) => svc.set(sessionID, status))
  // kilocode_change end
}
