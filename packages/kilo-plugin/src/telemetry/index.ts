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
// document of a location drops the events of that location whatever the consent.
const state = {
  consent: null as boolean | null,
  engine: undefined as Promise<typeof Telemetry> | undefined,
  users: 0,
}

export const KiloTelemetryPlugin = define<Global.Service | Scope.Scope>({
  id: "kilocode.telemetry",
  effect: Effect.fn("KiloTelemetryPlugin")(function* (ctx) {
    const global = yield* Global.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const directory = ctx.location.directory

    const allowed = Effect.fn("KiloTelemetryPlugin.allowed")(function* () {
      if (Option.isNone(config)) return true
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
      return state.engine
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
            const engine = yield* Effect.promise(start)
            // A consent withdrawn while the engine started drops the event.
            if (state.consent !== true) return { captured: false }
            engine.track(input.event, input.properties)
            return { captured: true }
          }),
        setEnabled: (input) =>
          Effect.gen(function* () {
            state.consent = input.enabled
            const engine = state.engine
            if (engine) yield* Effect.promise(() => engine.then((item) => item.setEnabled(input.enabled)))
            return yield* read()
          }),
        state: () => read(),
      })
      .pipe(Effect.orDie)

    // A sign-in, sign-out or team switch changes the identity of the next event, once the engine runs.
    const unsubscribe = KiloGatewayAccounts.subscribe(directory, () => {
      void state.engine?.then(identify)
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
        yield* Effect.tryPromise(async () => (await engine).shutdown(2000)).pipe(
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
