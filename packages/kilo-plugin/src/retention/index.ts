export * as KiloSessionRetention from "./index"

import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Session } from "@opencode/core/session"
import { SessionStore } from "@opencode/core/session/store"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import { DateTime, Effect, Option, Schema, Scope } from "effect"
import { KiloRetention } from "./retention"

const decodeResult = Schema.decodeUnknownOption(KiloRetentionRpc.Result)

// The `kilocode.retention` RPC. Every Location of a server shares one engine through the session store, so one pass
// covers the whole store and a second run joins it. The last result lives in plugin storage, which is machine-wide.
export const Plugin = define<SessionStore.Service | Scope.Scope>({
  id: "kilocode.retention",
  effect: Effect.fn("KiloSessionRetention")(function* (ctx) {
    const store = yield* SessionStore.Service
    // Location services: the supervisor provides them to host plugins, outside the plugin's typed requirements.
    const sessions = yield* Effect.serviceOption(Session.Service)
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(sessions) || Option.isNone(config))
      return yield* Effect.die(new Error("Kilo session retention requires the session and config services"))
    const scope = yield* Scope.Scope
    const engine = KiloRetention.shared(store)
    const input = deps({ store, sessions: sessions.value, config: config.value, storage: ctx.storage })

    yield* ctx.rpc
      .register(KiloRetentionRpc.Definition, {
        status: () => engine.status(input),
        run: (request) => engine.run(input, { force: request.force === true }, scope),
        cancel: () => Effect.sync(() => ({ requested: engine.cancel() })),
      })
      .pipe(Effect.orDie)
  }),
})

/** The engine's reads and writes over the session store, the Location config and the plugin's storage. */
export function deps(input: {
  readonly store: SessionStore.Interface
  readonly sessions: Session.Interface
  readonly config: Config.Interface
  readonly storage: Context["storage"]
}): KiloRetention.Deps {
  return {
    policy: input.config
      .entries()
      .pipe(Effect.map((entries) => KiloRetention.policy(KiloConfigPolicy.retentionConfig(entries)))),
    sessions: input.store
      .list()
      .pipe(
        Effect.map((rows) =>
          rows.map((row) => ({ id: row.id, parentID: row.parentID, updated: DateTime.toEpochMillis(row.time.updated) })),
        ),
      ),
    active: input.sessions.active,
    claimed: input.store.listSuspended(),
    remove: (sessionID) => input.sessions.remove(sessionID),
    exists: (sessionID) => input.store.get(sessionID).pipe(Effect.map((row) => row !== undefined)),
    last: input.storage.get("last").pipe(Effect.map((value) => Option.getOrUndefined(decodeResult(value)))),
    record: (result) => input.storage.set("last", result),
  }
}
