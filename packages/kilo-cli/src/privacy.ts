import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import type { Layout } from "./paths"
import { createPrivacyStore } from "./privacy-settings"
import { PrivacyRpc, type PrivacyState } from "./privacy-rpc"
import type { RpcHandlers } from "@opencode-ai/plugin/effect/rpc"

export const PRIVACY_PLUGIN_ID = "kilocode.privacy"

export interface PrivacyPluginOptions {
  readonly layout: Layout
}

type PrivacyUpdate = (state: PrivacyState) => Effect.Effect<void, never>

export function createPrivacyRpcHandlers(
  options: PrivacyPluginOptions,
  onUpdate: PrivacyUpdate = () => Effect.void,
): RpcHandlers<typeof PrivacyRpc.Definition> {
  const store = createPrivacyStore(options)
  return {
    read: (_input, call) =>
      Effect.tryPromise({
        try: () => store.read(),
        catch: (error) => call.error("kilocode.privacy", message(error)),
      }),
    set: (input, call) =>
      Effect.tryPromise({
        try: () => store.set(input.enabled),
        catch: (error) => call.error("kilocode.privacy", message(error)),
      }).pipe(Effect.tap(onUpdate)),
  }
}

/** Location-scoped RPC plugin for the isolated profile privacy setting. */
export function createPrivacyPlugin(options: PrivacyPluginOptions): Plugin {
  return define({
    id: PRIVACY_PLUGIN_ID,
    effect: (ctx) =>
      Effect.fn("KiloPrivacyPlugin.effect")(function* () {
        let publish: PrivacyUpdate = () => Effect.void
        const registration = yield* ctx.rpc.register(
          PrivacyRpc.Definition,
          createPrivacyRpcHandlers(options, (state) => publish(state)),
        )
        publish = (state) => registration.events.emit("updated", state).pipe(Effect.orDie)
      })().pipe(Effect.orDie),
  })
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return "Unable to complete the Kilo privacy operation"
}
