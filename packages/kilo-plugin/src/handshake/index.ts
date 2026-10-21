import { define } from "@opencode/plugin/effect/plugin"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { Effect } from "effect"

// The handshake of a Kilo v2 server (U-E1-08): the `kilocode.handshake` RPC that clients call first. The version and
// channel are the app identity that the Kilo host gives the server (`KiloApp` in packages/kilo-cli).
export const KiloHandshakePlugin = define({
  id: "kilocode.handshake",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.rpc
      .register(KiloHandshakeRpc.Definition, {
        get: () => Effect.succeed({ product: "kilo" as const, version: ctx.app.version, channel: ctx.app.channel }),
      })
      .pipe(Effect.orDie)
  }),
})
