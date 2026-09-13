import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Fiber, Layer } from "effect"
import { fireLayer, text as wakeupText } from "./resume"
import * as schema from "./schema"

export namespace Wakeup {
  export const MIN_DELAY_MS = schema.MIN_DELAY_MS
  export const MAX_HORIZON_MS = schema.MAX_HORIZON_MS
  export const MAX_PER_SESSION = schema.MAX_PER_SESSION
  export const ID = schema.ID
  export type ID = schema.ID
  export const Info = schema.Info
  export type Info = schema.Info
  export const Input = schema.Input
  export type Input = schema.Input
  export const InvalidTime = schema.InvalidTime
  export type InvalidTime = schema.InvalidTime
  export const PastTime = schema.PastTime
  export type PastTime = schema.PastTime
  export const TooMany = schema.TooMany
  export type TooMany = schema.TooMany
  export const Fire = schema.Fire
  export type Fire = schema.Fire
  export const resolve = schema.resolve
  export const clampNotice = schema.clampNotice
  export const text = wakeupText

  export interface Interface {
    readonly schedule: (input: Input) => Effect.Effect<Info, InvalidTime | PastTime | TooMany>
    readonly list: (input?: { sessionID?: SessionID }) => Effect.Effect<Info[]>
    readonly cancel: (id: ID) => Effect.Effect<Info | undefined>
    readonly adopt: (directory: string) => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Wakeup") {}

  const key = (info: { sessionID: SessionID; id: ID }) => ["wakeup", String(info.sessionID), String(info.id)]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const fire = yield* Fire
      // Timers live in the service scope, so tearing the layer down stops them.
      const scope = yield* Effect.scope
      const timers = new Map<ID, Fiber.Fiber<void>>()
      const entries = new Map<ID, Info>()

      const stop = () => {
        for (const fiber of timers.values()) fiber.interruptUnsafe()
        timers.clear()
      }
      const unregister = KiloShutdown.register(stop)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unregister()
          stop()
        }),
      )

      const read = (target: string[]) =>
        storage.read<Info>(target).pipe(Effect.catch(() => Effect.succeed(undefined)))

      const lookup = Effect.fnUntraced(function* (id: ID) {
        const known = entries.get(id)
        if (known) return known
        const keys = yield* storage.list(["wakeup"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          if (target.at(-1) !== id) continue
          const info = yield* read(target)
          if (info) return info
        }
        return undefined
      })

      const fireNow = (info: Info) =>
        Effect.gen(function* () {
          entries.delete(info.id)
          timers.delete(info.id)
          yield* fire
            .run(info)
            .pipe(Effect.catchCause((cause) => Effect.logError("wakeup fire failed", { id: info.id, cause })))
          yield* storage.remove(key(info)).pipe(Effect.ignore)
        })

      const arm = (info: Info) =>
        Effect.gen(function* () {
          const delay = Math.max(0, info.dueAt - Date.now())
          const fiber = yield* Effect.forkIn(
            Effect.sleep(`${delay} millis`).pipe(Effect.andThen(fireNow(info))),
            scope,
          )
          timers.set(info.id, fiber)
        })

      const schedule = Effect.fn("Wakeup.schedule")(function* (input: Input) {
        const now = Date.now()
        const dueAt = yield* schema.resolve(input, now)
        const pending = yield* storage
          .list(["wakeup", String(input.sessionID)])
          .pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        if (pending.length >= MAX_PER_SESSION) {
          return yield* new TooMany({ message: `A session can hold at most ${MAX_PER_SESSION} pending wakeups` })
        }
        const info: Info = {
          id: ID.ascending(),
          sessionID: input.sessionID,
          directory: input.directory,
          prompt: input.prompt,
          reason: input.reason,
          agent: input.agent,
          dueAt,
          created: now,
        }
        yield* storage.write(key(info), info).pipe(Effect.orDie)
        entries.set(info.id, info)
        yield* arm(info)
        return info
      })

      const list = Effect.fn("Wakeup.list")(function* (input?: { sessionID?: SessionID }) {
        return Array.from(entries.values())
          .filter((info) => !input?.sessionID || info.sessionID === input.sessionID)
          .toSorted((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))
      })

      const cancel = Effect.fn("Wakeup.cancel")(function* (id: ID) {
        const info = yield* lookup(id)
        if (!info) return undefined
        const fiber = timers.get(id)
        if (fiber) {
          timers.delete(id)
          yield* Fiber.interrupt(fiber)
        }
        entries.delete(id)
        yield* storage.remove(key(info)).pipe(Effect.ignore)
        return info
      })

      const adopt = Effect.fn("Wakeup.adopt")(function* (directory: string) {
        const keys = yield* storage.list(["wakeup"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          const info = yield* read(target)
          if (!info || info.directory !== directory) continue
          if (entries.has(info.id) || timers.has(info.id)) continue
          entries.set(info.id, info)
          if (info.dueAt <= Date.now()) yield* fireNow(info)
          else yield* arm(info)
        }
      })

      return Service.of({ schedule, list, cancel, adopt })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(fireLayer))

  export const node = LayerNode.make({ service: Service, layer: defaultLayer, deps: [Storage.node] })
}

export * from "./schema"
