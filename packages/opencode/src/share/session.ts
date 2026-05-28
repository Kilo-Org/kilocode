import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"

export interface Interface {
  readonly create: (input?: Session.CreateInput) => Effect.Effect<Session.Info>
  readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope
    const sync = yield* SyncEvent.Service

    const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID) {
      const conf = yield* cfg.get()
      if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
      // kilocode_change start - use KiloSessions instead of ShareNext (upstream OC backend not supported)
      const result = yield* Effect.promise(async () => {
        const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
        return KiloSessions.share(sessionID)
      })
      // kilocode_change end
      yield* sync.run(Session.Event.Updated, { sessionID, info: { share: { url: result.url } } })
      return result
    })

    const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
      // kilocode_change start - use KiloSessions instead of ShareNext (upstream OC backend not supported)
      yield* Effect.promise(async () => {
        const { KiloSessions } = await import("@/kilo-sessions/kilo-sessions")
        await KiloSessions.unshare(sessionID)
      })
      // kilocode_change end
      yield* sync.run(Session.Event.Updated, { sessionID, info: { share: { url: null } } })
    })

    const create = Effect.fn("SessionShare.create")(function* (input?: Session.CreateInput) {
      const result = yield* session.create(input)
      if (result.parentID) return result
      const conf = yield* cfg.get()
      if (!(Flag.KILO_AUTO_SHARE || conf.share === "auto")) return result // kilocode_change
      yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
      return result
    })

    return Service.of({ create, share, unshare })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
)

export * as SessionShare from "./session"
