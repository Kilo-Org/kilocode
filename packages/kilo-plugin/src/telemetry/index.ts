import type { Telemetry } from "@kilocode/kilo-telemetry"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloTelemetryRpc } from "@opencode/schema/kilocode/telemetry"
import { Global } from "@opencode/util/global"
import { Effect, Option, type Scope } from "effect"
import { KiloGatewayAccounts } from "../gateway/accounts"

// The `kilocode.telemetry` RPC: clients capture product events here and the process-wide engine in
// packages/kilo-telemetry delivers them to PostHog. The client's consent is process-wide: it lives for this server
// process, as the client sends it again after each start. Before a client records consent nothing is sent, and the
// engine (and its PostHog client) is not even loaded. `experimental.openTelemetry: false` in any effective config
// document of a location, or `KILO_TELEMETRY_LEVEL` set to anything but `all`, keeps that location local whatever the
// consent: no event, no profile lookup for the identity.
const state: {
  consent: boolean | null
  engine?: Promise<typeof Telemetry>
  stopping?: Promise<void>
  users: number
} = { consent: null, users: 0 }

export const KiloTelemetryPlugin = define<Global.Service | Scope.Scope>({
  id: "kilocode.telemetry",
  effect: Effect.fn("KiloTelemetryPlugin")(function* (ctx) {
    const global = yield* Global.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const directory = ctx.location.directory

    const run = Effect.runPromiseWith(yield* Effect.context<never>())

    const allowed = Effect.fn("KiloTelemetryPlugin.allowed")(function* () {
      const level = process.env.KILO_TELEMETRY_LEVEL
      if (level && level !== "all") return false
      // Without the location config the setting cannot be read, so the location stays local.
      if (Option.isNone(config)) return false
      return KiloConfigPolicy.openTelemetry(yield* config.value.entries())
    })

    const identify = (engine: typeof Telemetry) => {
      const account = KiloGatewayAccounts.get(directory)
      return engine.updateIdentity(account?.token ?? null, account?.organizationID, account?.server)
    }

    // The engine starts on the first event that may leave the machine, and resolves the account email first so the
    // first event already carries the user's identity.
    const start = () => {
      state.engine ??= (async () => {
        // A shutdown of the previous engine must finish first, or it would close the client this start creates.
        await state.stopping
        const { Telemetry } = await import("@kilocode/kilo-telemetry")
        await Telemetry.init({
          dataPath: global.data,
          version: ctx.app.version,
          enabled: true,
          host: process.env.KILO_TELEMETRY_URL || undefined,
        })
        await identify(Telemetry)
        return Telemetry
      })()
      const engine = state.engine
      // A failed start is not remembered, so the next event tries again.
      engine.catch(() => {
        if (state.engine === engine) state.engine = undefined
      })
      return engine
    }

    const read = Effect.fn("KiloTelemetryPlugin.read")(function* () {
      const permitted = yield* allowed()
      return { enabled: state.consent === true && permitted, consent: state.consent, config: permitted }
    })

    yield* ctx.rpc
      .register(KiloTelemetryRpc.Definition, {
        capture: (input) =>
          Effect.gen(function* () {
            if (!(yield* read()).enabled) return { captured: false }
            const engine = yield* Effect.tryPromise(start).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("telemetry engine failed to start", { cause }).pipe(Effect.as(undefined)),
              ),
            )
            // A consent withdrawn while the engine started drops the event.
            if (!engine || state.consent !== true) return { captured: false }
            engine.track(input.event, input.properties)
            return { captured: true }
          }),
        setEnabled: (input) =>
          Effect.gen(function* () {
            state.consent = input.enabled
            const engine = state.engine
            if (engine)
              yield* Effect.tryPromise(() => engine.then((item) => item.setEnabled(input.enabled))).pipe(
                Effect.catchCause((cause) => Effect.logWarning("telemetry engine failed to start", { cause })),
              )
            return yield* read()
          }),
        state: () => read(),
      })
      .pipe(Effect.orDie)

    // A sign-in, sign-out or team switch changes the identity of the next event, once the engine runs, and only where
    // this location may send: the lookup asks the Kilo API and can send the alias of the machine.
    const unsubscribe = KiloGatewayAccounts.subscribe(directory, () => {
      const engine = state.engine
      if (!engine) return
      void run(read())
        .then((current) => (current.enabled ? engine.then(identify) : undefined))
        .catch((error: unknown) => run(Effect.logWarning("telemetry identity update failed", { error })))
    })

    state.users++
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        unsubscribe()
        state.users--
        const engine = state.engine
        if (state.users > 0 || !engine) return
        state.engine = undefined
        // Bounded, so an unreachable endpoint (offline, firewall, DNS block) cannot hold up the server shutdown.
        const stopping = engine.then((item) => item.shutdown(2000))
        state.stopping = stopping.then(
          () => undefined,
          () => undefined,
        )
        yield* Effect.tryPromise(() => stopping).pipe(
          Effect.catchCause((cause) => Effect.logWarning("telemetry shutdown failed", { cause })),
        )
      }),
    )
  }),
})

/** Test seam: forget the consent of an earlier server in the same process. */
export function resetConsent() {
  state.consent = null
}
