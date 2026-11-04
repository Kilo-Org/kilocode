import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloPrivacyRpc } from "@opencode/schema/kilocode/privacy"
import { Effect, Option } from "effect"

// The `kilocode.privacy` RPC: privacy mode of the location's effective config, for the clients that redact account
// details on screen.
export const KiloPrivacyPlugin = define({
  id: "kilocode.privacy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo privacy mode requires location config"))
    yield* ctx.rpc
      .register(KiloPrivacyRpc.Definition, {
        get: () =>
          config.value.entries().pipe(Effect.map((entries) => ({ enabled: KiloConfigPolicy.privacyMode(entries) }))),
      })
      .pipe(Effect.orDie)
  }),
})
